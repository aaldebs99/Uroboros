# Uploads

People add their own videos to their library from the **Add** menu's **Upload**: a file, a title,
a description, a creator (their display name unless they name someone), tags, and a thumbnail if
they have one (without one, a frame of the video stands in). The uploader can change the title,
description, creator and thumbnail later, from the video's page (Edit details, in its ⋮ menu). The file is
stored exactly as it was sent, metadata included.

## Sending the file

A video is often gigabytes, and one request that long would not survive a deploy (the drain is
20 s), a replica switch, Node's 300 s request timeout or a proxy's body cap. So the browser sends
it in **parts of 8 MiB**, each its own short request, straight into the media store:

1. `POST /api/uploads` with the file's name and size, the title and the rest. The server checks
   the extension (mp4, m4v, mov, webm, mkv or avi), the size (`UROBOROS_UPLOAD_MAX_BYTES`, 10 GiB
   by default, at most 80 GiB: 10,000 parts) and that the person has fewer than five unfinished
   uploads (counted under their `UPLD` advisory lock, so uploads started at once can't pass it). It
   starts the store's upload and answers with the upload's id and part size.
2. `PUT /api/uploads/{id}/parts/{n}`: part `n` (from 1), exactly the part size (the last, what is
   left), in any order, to any replica. A failed part is sent again.
3. `PUT /api/uploads/{id}/thumbnail`, if the person picked one: a JPEG, PNG or WebP image of up to
   5 MiB, known by its bytes.
4. `POST /api/uploads/{id}/complete` once every part is in: the upload goes to `processing` and
   its `upload` job is queued in the same transaction.

`GET /api/uploads/{id}` lists the parts received, so a tab reloaded midway resumes once its person
picks the same file again (matched by name and size): only the missing parts are sent. The browser
tries a part, the complete and its checks on the processing again after a network or server error
(1 s, 3 s, 9 s), and Try again picks up from the server's own state: the rest of the parts, or the
wait for a video it is processing or has filed.
`DELETE /api/uploads/{id}` cancels an upload still receiving (its bytes go) or dismisses a failed
one. Every route is the uploader's alone; anyone else gets 404.

The raw-body routes take their own body limits (a part, or 5 MiB) and the JSON limit
(`UROBOROS_BODY_LIMIT_BYTES`) skips them. **A reverse proxy in front must accept 8 MiB request
bodies**; nginx's default is 1 MiB (`client_max_body_size 16m;`). Caddy (compose) has no cap.

### In the store

The `MediaStore` writes a file in parts (`startUpload`, `putPart`, `completeUpload`,
`abortUpload`):

- **S3**: a multipart upload, with a CRC32 checksum on each part as lib-storage sends them; each
  part's ETag and checksum are kept in `upload_parts` and sent back on completion.
- **Filesystem**: a temp file beside the final path, created at the start, each part written at its
  offset (opened `r+`, so a part arriving after a cancel can't bring the file back), renamed on
  completion once its size is right.

An upload's bytes always go before its row (a cancel, the sweep), so bytes a failing store keeps
stay named for another try. As a backstop for an upload whose row never committed, give the bucket
an `AbortIncompleteMultipartUpload` lifecycle rule (a few days) where the S3 server supports one.

Completion refuses parts that are not exactly 1 to N or don't add up to the size, and is harmless
to repeat. An upload's key is `media/<media id>/upload.<ext>` on S3; on a filesystem it follows
`UROBOROS_STORAGE_LAYOUT` with the creator as the channel, the upload day as the date and `upload`
as the profile (every layout holds `{id}`, the upload's, so no two meet). Editing the title later
does not move the file, as with downloads.

## Filing it

The `upload` job (lease 60 s, two stalls, three tries 10 s and 20 s apart, two at once per replica):

1. puts the parts together in the store;
2. reads the file with ffprobe (its path, or an S3 read URL), with its demuxers pinned to MP4/MOV,
   Matroska/WebM and AVI (`-format_whitelist mov,matroska,avi`, and a local file held to the file
   protocol): ffmpeg picks a demuxer by content, so a playlist named `.mp4` (HLS, ffconcat) would
   otherwise make the server fetch URLs or read other files (every later read of a stored file is
   pinned too, to the wider list a download may be in; docs/downloads.md). A file in any other container, or with
   no video stream, fails at once, "That file has no video we can read". Every later reader
   (playback sessions, keyframes) reads only a file that passed this check;
3. grabs a frame (a tenth of the way in, no later than a minute) with the image's own ffmpeg when
   the person sent no thumbnail; a frame that can't be taken leaves the video without one;
4. in one transaction under the upload's row lock, while it is still `processing`: a media row of
   its own (extractor `upload`, which no site's is, the upload's id as its video id, the creator as
   its channel and uploader, `uploaded_by`), a rendition with no format profile (revision
   `upload`, its codecs from ffprobe), the person's entry and their tags; the upload is `done`.

On its last try (or at once for a file with no video) the upload is `failed` and its bytes go, but
only while it is still processing with no entry, under the same lock: a run that lost its job
never undoes one that filed it. A shutdown cut puts the job back without spending a try.
Keyframes are indexed later, by the first playback session that needs them.

An uploaded video then behaves like a download: it is searchable, plays (directly, or through a
playback session when the browser can't), and can be shared. Its entry has `origin: "upload"` and
no profile name; its file downloads as `<title>.<ext>`. Removing it from the library deletes the
file after the reaper's grace (a day), unless someone it was shared with added it to theirs: an
upload can't be downloaded again.

## The sweep

The leader's upload duty runs every minute:

- an upload processing for over six hours fails;
- one processing whose job is gone (the stall limit drops a job without its processor running) gets
  its job back;
- one receiving untouched for a day, or whose person's account is gone, and a failed one after a
  week, is dropped: its bytes first, then its row, each row on its own (one the store fails stays
  for the next sweep);
- done rows are forgotten after a day (their video stays).

## Editing

The video's ⋮ menu offers **Edit details** when the item's `editable` is true: the caller uploaded
it and holds it in their own library. The dialog shows the title, description, creator and the
current thumbnail, and previews a picked image from a data: URL (the page's image policy allows
those; blob: it does not).

`PATCH /api/library/{id}/details` (title, description, creator, each only when given) and `PUT
/api/library/{id}/thumbnail` (an image, as above) change an uploaded video for everyone who holds
it. Only its uploader may, on their own entry. Anyone else's PATCH, on a downloaded video or on
someone's upload in their library, gives it details of their own, for them alone
([library.md](library.md#your-own-details)); the thumbnail stays the uploader's (403). A replaced
thumbnail gets a new storage key, so its versioned URL changes and browsers show it at once; the
old file goes to the trash.
