from session import SessionState, expire


def test_expired_session_is_rejected():
    session = SessionState("m4-session-token")
    assert expire(session, "m4-session-token") is None
    assert not session.active
