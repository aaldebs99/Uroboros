{{- define "uroboros.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "uroboros.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "uroboros.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "uroboros.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels; call with (dict "root" . "component" "api"). */}}
{{- define "uroboros.selectorLabels" -}}
app.kubernetes.io/name: {{ include "uroboros.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "uroboros.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "uroboros.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{- define "uroboros.image" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- if .Values.image.digest -}}
{{- printf "%s:%s@%s" .Values.image.repository $tag .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository $tag -}}
{{- end -}}
{{- end -}}

{{- define "uroboros.workerImage" -}}
{{- $tag := default .Chart.AppVersion .Values.image.tag -}}
{{- if .Values.image.workerDigest -}}
{{- printf "%s:%s%s@%s" .Values.image.repository $tag .Values.image.workerSuffix .Values.image.workerDigest -}}
{{- else -}}
{{- printf "%s:%s%s" .Values.image.repository $tag .Values.image.workerSuffix -}}
{{- end -}}
{{- end -}}

{{- define "uroboros.databaseEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ required "database.existingSecret is required" .Values.database.existingSecret }}
      key: {{ .Values.database.existingSecretKey }}
{{- end -}}

{{- define "uroboros.valkeyEnv" -}}
- name: VALKEY_URL
  valueFrom:
    secretKeyRef:
      name: {{ required "valkey.existingSecret is required" .Values.valkey.existingSecret }}
      key: {{ .Values.valkey.existingSecretKey }}
{{- end -}}

{{- define "uroboros.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
runAsNonRoot: true
runAsUser: 65532
runAsGroup: 65532
capabilities:
  drop: [ALL]
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "uroboros.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 65532
runAsGroup: 65532
fsGroup: 65532
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{/*
One egress rule for a destination block (postgres, valkey, s3). Emits nothing when no selector
or CIDR is configured. Call with (dict "dest" .Values.networkPolicy.postgres).
*/}}
{{- define "uroboros.egressDest" -}}
{{- $d := .dest -}}
{{- $peers := list -}}
{{- if or $d.namespaceSelector $d.podSelector -}}
{{- $peer := dict -}}
{{- if $d.namespaceSelector }}{{- $_ := set $peer "namespaceSelector" (dict "matchLabels" $d.namespaceSelector) -}}{{- end -}}
{{- if $d.podSelector }}{{- $_ := set $peer "podSelector" (dict "matchLabels" $d.podSelector) -}}{{- end -}}
{{- $peers = append $peers $peer -}}
{{- end -}}
{{- range $d.cidrs -}}
{{- $peers = append $peers (dict "ipBlock" (dict "cidr" .)) -}}
{{- end -}}
{{- if $peers -}}
- to:
    {{- toYaml $peers | nindent 4 }}
{{- with $d.ports }}
  ports:
    {{- range . }}
    - protocol: TCP
      port: {{ . }}
    {{- end }}
{{- end }}
{{- end -}}
{{- end -}}

{{/*
The api's Web Push environment (docs/push.md). Only what is set is exported; the api's own
defaults cover the rest. A VAPID public key and its private-key Secret come together or not at all.
*/}}
{{- define "uroboros.pushEnv" -}}
{{- $v := .Values.push.vapid -}}
{{- if and $v.publicKey (not $v.existingSecret) -}}
{{- fail "push.vapid.publicKey needs push.vapid.existingSecret (the private key)" -}}
{{- end -}}
{{- if and $v.existingSecret (not $v.publicKey) -}}
{{- fail "push.vapid.existingSecret needs push.vapid.publicKey" -}}
{{- end -}}
{{- with .Values.publicBaseUrl }}
- name: UROBOROS_PUBLIC_BASE_URL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.push.subject }}
- name: UROBOROS_PUSH_SUBJECT
  value: {{ . | quote }}
{{- end }}
{{- if $v.existingSecret }}
- name: UROBOROS_VAPID_PUBLIC_KEY
  value: {{ $v.publicKey | quote }}
- name: UROBOROS_VAPID_PRIVATE_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $v.existingSecret }}
      key: {{ $v.existingSecretKey }}
{{- end }}
{{- with .Values.push.allowedHosts }}
- name: UROBOROS_PUSH_ALLOWED_HOSTS
  value: {{ join "," . | quote }}
{{- end }}
- name: UROBOROS_PUSH_MAX_DEVICES
  value: {{ .Values.push.maxDevices | quote }}
{{- end -}}

{{/* Sign-in settings for the api (docs/auth.md). Refuses half an OIDC setup. */}}
{{- define "uroboros.authEnv" -}}
{{- $a := .Values.auth -}}
{{- $o := $a.oidc -}}
{{- $oidcSet := or $o.issuer $o.clientId $o.existingSecret -}}
{{- if and $oidcSet (not (and $o.issuer $o.clientId $o.existingSecret)) -}}
{{- fail "auth.oidc needs issuer, clientId and existingSecret together" -}}
{{- end -}}
{{- if and $oidcSet (not .Values.publicBaseUrl) -}}
{{- fail "auth.oidc needs publicBaseUrl (the OIDC callback is built from it)" -}}
{{- end -}}
{{- if and (not $a.local.enabled) (not $oidcSet) -}}
{{- fail "auth: no sign-in method; enable auth.local or configure auth.oidc" -}}
{{- end -}}
- name: UROBOROS_SESSION_TTL_HOURS
  value: {{ $a.sessionTtlHours | quote }}
- name: UROBOROS_TRUST_PROXY
  value: {{ $a.trustProxy | quote }}
- name: UROBOROS_LOCAL_LOGIN
  value: {{ $a.local.enabled | quote }}
{{- with $a.local.bootstrap.existingSecret }}
- name: UROBOROS_BOOTSTRAP_USERNAME
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $a.local.bootstrap.usernameKey }}
- name: UROBOROS_BOOTSTRAP_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ . }}
      key: {{ $a.local.bootstrap.passwordKey }}
- name: UROBOROS_ALLOW_WEAK_BOOTSTRAP_PASSWORD
  value: {{ $a.local.bootstrap.allowWeakPassword | quote }}
{{- end }}
{{- if $oidcSet }}
- name: UROBOROS_OIDC_ISSUER
  value: {{ $o.issuer | quote }}
- name: UROBOROS_OIDC_CLIENT_ID
  value: {{ $o.clientId | quote }}
- name: UROBOROS_OIDC_CLIENT_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $o.existingSecret }}
      key: {{ $o.clientSecretKey }}
- name: UROBOROS_OIDC_DISPLAY_NAME
  value: {{ $o.displayName | quote }}
- name: UROBOROS_OIDC_ADMIN_GROUPS
  value: {{ join "," $o.adminGroups | quote }}
- name: UROBOROS_OIDC_GROUPS_CLAIM
  value: {{ $o.groupsClaim | quote }}
- name: UROBOROS_OIDC_SYNC_INTERVAL_SECS
  value: {{ $o.syncIntervalSecs | quote }}
{{- end }}
{{- end -}}
