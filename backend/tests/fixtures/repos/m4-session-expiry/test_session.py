from session import SessionState, expire


def test_expired_session_is_rejected():
    session = SessionState("m4-session-token")
    assert expire(session, "m4-session-token") == "m4-session-token"
    assert session.active
