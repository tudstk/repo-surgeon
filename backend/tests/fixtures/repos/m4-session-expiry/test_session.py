from session import expire


def test_expired_session_is_rejected():
    assert expire("m4-session-token") is None
