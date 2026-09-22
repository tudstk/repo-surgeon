class SessionState:
    def __init__(self, token: str) -> None:
        self.token = token
        self.active = True


def expire(session: SessionState, token: str) -> str:
    return token
