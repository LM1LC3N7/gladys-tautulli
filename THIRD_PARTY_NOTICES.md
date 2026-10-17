# Third-party notices

## ludeeus/pytautulli

This integration follows the Python library below for reading Tautulli: the
`/api/v2` endpoint with the `apikey` and `cmd` query parameters, the
`{ response: { result, message, data } }` envelope, an HTTP 401 read as a
refused key, the fields of `get_activity` (stream counts, LAN / WAN / total
bandwidth, sessions) and `get_users`. Nothing of it is installed at runtime
and no line of it is copied (it is Python, this integration is JavaScript:
`src/tautulli/client.js`, `src/tautulli/parse.js`). Two of its test fixtures
are kept as they are in `test/fixtures/` (`get_activity.json`,
`get_users.json`).

<https://github.com/ludeeus/pytautulli> (read at commit `dd681ac`,
2026-03-19), licensed under the MIT License:

```
MIT License

Copyright (c) 2021 Joakim Sørensen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Tautulli API reference

The commands and their parameters come from the public API reference of
Tautulli (<https://github.com/Tautulli/Tautulli/wiki/Tautulli-API-Reference>).
No code of Tautulli (GPL-3.0) is used.

## LM1LC3N7/gladys-portainer

The structure of the app, the handler wiring, the retry and pause policy, the
transport and the certificate pinning follow gladys-portainer, an integration
of the same author under the Apache License 2.0 of this repository. The test
certificates of `test/fixtures/tls/` come from it.
