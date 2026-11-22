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
