# curl_cffi and the libraries it bundles

The image's venv (`/opt/yt-dlp`) holds curl_cffi, pinned in `scripts/image/requirements.txt`, which
gives yt-dlp browser impersonation. Its wheel's one native module, `curl_cffi/_wrapper.abi3.so`, is
statically linked against the libraries below, but the wheel ships only curl_cffi's own licence.
Their licence texts are here, copied from each project, and the image installs this folder as
`/usr/share/licenses/curl_cffi/`.

| File                   | What                                               | Licence          | Source                                         |
| ---------------------- | -------------------------------------------------- | ---------------- | ---------------------------------------------- |
| `curl_cffi.txt`        | curl_cffi 0.17.0, the Python binding               | MIT              | https://github.com/lexiforest/curl_cffi        |
| `curl-impersonate.txt` | curl-impersonate 2.3.0, the patched curl it builds | MIT              | https://github.com/lexiforest/curl-impersonate |
| `curl.txt`             | libcurl 8.23.0                                     | curl (MIT-style) | https://github.com/curl/curl                   |
| `boringssl.txt`        | BoringSSL, the TLS library                         | Apache-2.0       | https://boringssl.googlesource.com/boringssl   |
| `nghttp2.txt`          | nghttp2 (HTTP/2)                                   | MIT              | https://github.com/nghttp2/nghttp2             |
| `nghttp3.txt`          | nghttp3 (HTTP/3)                                   | MIT              | https://github.com/ngtcp2/nghttp3              |
| `ngtcp2.txt`           | ngtcp2 (QUIC)                                      | MIT              | https://github.com/ngtcp2/ngtcp2               |
| `brotli.txt`           | Brotli                                             | MIT              | https://github.com/google/brotli               |
| `zstd.txt`             | Zstandard                                          | BSD-3-Clause     | https://github.com/facebook/zstd               |
| `zlib.txt`             | zlib 1.3.1                                         | zlib             | https://github.com/madler/zlib                 |

The libraries were read off the module's strings (`strings _wrapper.abi3.so`); the versions named
are the ones it reports or curl_cffi's release notes state. When a curl-cffi bump changes what it
bundles, update this folder in the same PR.
