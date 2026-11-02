"""Pure client-label derivation: '{Browser} ({OS})' from a User-Agent.
"""

UA_CHROME_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
UA_CHROME_MACOS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
UA_CHROME_LINUX = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
UA_FIREFOX_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
)
UA_SAFARI_MACOS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.1 Safari/605.1.15"
)
UA_EDGE_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"
)
UA_CHROME_ANDROID = (
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
)
UA_SAFARI_IOS = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1"
)
UA_CHROME_UNKNOWN_OS = (
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
UA_GARBAGE = "curl/8.4.0"


class TestDeriveClientLabel:
    """Exact '{Browser} ({OS})' outputs per the contract table."""

    def test_chrome_windows(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_CHROME_WINDOWS) == "Chrome (Windows)"

    def test_chrome_macos(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_CHROME_MACOS) == "Chrome (macOS)"

    def test_chrome_linux(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_CHROME_LINUX) == "Chrome (Linux)"

    def test_firefox_windows(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_FIREFOX_WINDOWS) == "Firefox (Windows)"

    def test_safari_macos(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_SAFARI_MACOS) == "Safari (macOS)"

    def test_edge_windows(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_EDGE_WINDOWS) == "Edge (Windows)"

    def test_chrome_android(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_CHROME_ANDROID) == "Chrome (Android)"

    def test_safari_ios(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_SAFARI_IOS) == "Safari (iOS)"

    def test_recognized_browser_unknown_os(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_CHROME_UNKNOWN_OS) == "Chrome"

    def test_garbage_ua(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(UA_GARBAGE) == "Browser"

    def test_none_ua(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label(None) == "Browser"

    def test_empty_ua(self) -> None:
        from wavecore.api.websocket.client_label import derive_client_label

        assert derive_client_label("") == "Browser"
