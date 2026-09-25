"""Encryption adapter for short-lived OAuth PKCE verifier storage."""

from base64 import urlsafe_b64encode
from hashlib import sha256

from cryptography.fernet import Fernet, InvalidToken

from repo_surgeon.domain.authentication import PkceVerifier


class FernetPkceVerifierCipher:
    """Encrypt PKCE verifier material with a key derived from application secret config."""

    def __init__(self, encryption_key: str) -> None:
        if not encryption_key:
            raise ValueError("an authentication encryption key is required")
        key = urlsafe_b64encode(sha256(encryption_key.encode("utf-8")).digest())
        self._fernet = Fernet(key)

    def encrypt(self, verifier: PkceVerifier) -> str:
        """Return Fernet ciphertext safe to store in the OAuth transaction row."""
        return self._fernet.encrypt(verifier.reveal_for_transport().encode("ascii")).decode("ascii")

    def decrypt(self, encrypted_verifier: str) -> PkceVerifier:
        """Recover a verifier after state was atomically consumed."""
        try:
            value = self._fernet.decrypt(encrypted_verifier.encode("ascii")).decode("ascii")
            return PkceVerifier(value)
        except (InvalidToken, UnicodeDecodeError) as error:
            raise ValueError("encrypted OAuth verifier is invalid") from error
