"""Single-owner login with signed, expiring HttpOnly cookies (no browser API keys)."""
import asyncio
import base64
from collections import deque
import hashlib
import hmac
import json
import secrets
import time

COOKIE='__Host-macan-session'
REMEMBER_SECONDS=30*24*3600
SESSION_SECONDS=12*3600


def b64(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')


class SessionAuth:
    def __init__(self,password,bridge_key):
        self.salt=hashlib.sha256(('macan-login:'+bridge_key).encode()).digest()
        self.password_hash=self.hash_password(password)
        self.signing_key=hmac.new(bridge_key.encode(),b'macan-session-v1:'+self.password_hash,hashlib.sha256).digest()
        self.failures=deque(maxlen=5)
        self.lock=asyncio.Lock()

    def hash_password(self,password):
        return hashlib.pbkdf2_hmac('sha256',password.encode(),self.salt,600_000)

    async def login(self,password,remember):
        now=time.monotonic()
        while self.failures and self.failures[0]<now-300:self.failures.popleft()
        if self.lock.locked() or len(self.failures)>=5:return None,429
        async with self.lock:
            actual=await asyncio.to_thread(self.hash_password,password)
            if not hmac.compare_digest(actual,self.password_hash):
                self.failures.append(time.monotonic())
                return None,401
            self.failures.clear()
            return self.issue(REMEMBER_SECONDS if remember else SESSION_SECONDS),200

    def issue(self,lifetime):
        now=int(time.time())
        payload=b64(json.dumps({'iat':now,'exp':now+lifetime,'nonce':secrets.token_urlsafe(24)},separators=(',',':')).encode())
        signature=b64(hmac.new(self.signing_key,payload.encode(),hashlib.sha256).digest())
        return payload+'.'+signature

    def valid(self,token):
        if not isinstance(token,str) or len(token)>1024:return False
        try:
            payload,signature=token.split('.')
            expected=b64(hmac.new(self.signing_key,payload.encode(),hashlib.sha256).digest())
            if not hmac.compare_digest(expected,signature):return False
            data=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
            now=time.time()
            return (type(data.get('iat')) is int and type(data.get('exp')) is int
                    and 0<=data['iat']<=now+60 and data['iat']<data['exp']<=data['iat']+REMEMBER_SECONDS
                    and now<data['exp'])
        except (ValueError,TypeError,UnicodeError):return False
