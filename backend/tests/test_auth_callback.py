"""Exercise fresh SDK login against the November 2026 callback contract.

All requests use MockTransport and synthetic credentials; no Porsche network
request is made. Existing valid-token tests do not exercise /authorize.
"""
import base64
import hashlib
from urllib.parse import parse_qs

import httpx
import pytest
from pyporscheconnectapi.connection import Connection
from pyporscheconnectapi import oauth2

from backend.provider import BridgeError, PorscheProvider


CALLBACK = 'https://security.porsche.com/auth/en-GB/app/callback'
OLD_CALLBACK = 'my-porsche-app://auth0/callback'
VIN = 'WP0ZZZ95ZLS000001'


@pytest.mark.asyncio
@pytest.mark.parametrize('legacy_callback', [False, True])
async def test_fresh_login_uses_allowed_callback_and_preserves_pkce(monkeypatch, legacy_callback):
    if legacy_callback:
        monkeypatch.setattr(oauth2, 'REDIRECT_URI', OLD_CALLBACK)
    requests = []
    challenge = None

    def upstream(request):
        nonlocal challenge
        requests.append((request.method, request.url.path))
        path = request.url.path
        if path == '/authorize':
            if request.url.params['redirect_uri'] != CALLBACK:
                return httpx.Response(403, text='Callback URL mismatch')
            assert request.url.params['code_challenge_method'] == 'S256'
            challenge = request.url.params['code_challenge']
            return httpx.Response(302, headers={'Location': '/u/login/identifier?state=test-state'})
        if path == '/u/login/identifier':
            return httpx.Response(302, headers={'Location': '/u/login/password?state=test-state'})
        if path == '/u/login/password':
            return httpx.Response(302, headers={'Location': '/authorize/resume?state=test-state'})
        if path == '/authorize/resume':
            return httpx.Response(302, headers={'Location': CALLBACK + '?code=test-code'})
        if path == '/oauth/token':
            form = parse_qs(request.content.decode())
            assert form['redirect_uri'] == [CALLBACK]
            assert form['code'] == ['test-code']
            digest = hashlib.sha256(form['code_verifier'][0].encode()).digest()
            assert base64.urlsafe_b64encode(digest).rstrip(b'=').decode() == challenge
            return httpx.Response(200, json={'access_token': 'test-access',
                                            'refresh_token': 'test-refresh', 'expires_in': 3600})
        if path == '/app/connect/v1/vehicles':
            return httpx.Response(200, json=[{'vin': VIN}])
        if path == '/app/connect/v1/vehicles/' + VIN:
            assert request.headers['authorization'] == 'Bearer test-access'
            return httpx.Response(200, json={'measurements': [
                {'key': 'BATTERY_LEVEL', 'status': {'isEnabled': True}, 'value': {'percent': 64}}
            ]})
        raise AssertionError('Unexpected mock endpoint')

    connection = Connection('test@example.invalid', 'test-password',
                            async_client=httpx.AsyncClient(transport=httpx.MockTransport(upstream)))
    provider = PorscheProvider('test@example.invalid', 'test-password', connection=connection)
    try:
        if legacy_callback:
            # The retired callback reproduces the user's generic communication
            # failure before any identifier/password or vehicle request.
            with pytest.raises(BridgeError, match='PORSCHE_UNAVAILABLE'):
                await provider.snapshot()
            assert requests == [('GET', '/authorize')]
        else:
            result = await provider.snapshot()
            assert result['snapshot']['soc'] == 64
            assert requests[:5] == [('GET', '/authorize'), ('POST', '/u/login/identifier'),
                                   ('POST', '/u/login/password'), ('GET', '/authorize/resume'),
                                   ('POST', '/oauth/token')]
            assert all(method == 'GET' for method, path in requests if path.startswith('/app/'))
    finally:
        await provider.close()
