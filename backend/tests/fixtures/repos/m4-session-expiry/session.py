class SessionState:
    def __init__(self, token):
        self.token = token
        self.active = True


def expire(session, token):
    return token
