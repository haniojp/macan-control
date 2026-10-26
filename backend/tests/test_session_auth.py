import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.app import Settings,create_app
from backend.session_auth import SessionAuth,COOKIE,REMEMBER_SECONDS

PASSWORD='test-login-passphrase-12345'
KEY='x'*48
ORIGIN='https://testserver'


class Provider:
    calls=0
    async def snapshot(self,**kwargs):
        self.calls+=1
        return {'schemaVersion':1,'fetchedAt':'2026-10-26T01:00:00Z','vehicleTimestamp':None,'snapshot':{'timestamp':'2026-10-26T01:00:00Z','soc':64,'rangeKm':280,'odometerKm':9000,'chargingStatus':'充電中','source':'api'}}
    async def close(self):pass


def app(password=PASSWORD):
    return create_app(Settings(KEY,'https://haniojp.github.io','owner','secret','',password,ORIGIN),Provider())


def login(client,remember=True,password=PASSWORD):
    return client.post('/auth/login',json={'password':password,'remember':remember},headers={'Origin':ORIGIN})


def test_private_pages_api_and_bearer_bypass_are_denied():
    with TestClient(app(),base_url=ORIGIN) as client:
        assert client.get('/',follow_redirects=False).headers['location']=='/login'
        assert client.get('/index.html',follow_redirects=False).status_code==303
        assert client.get('/api/snapshot').status_code==401
        assert client.get('/api/snapshot',headers={'Authorization':'Bearer '+KEY}).status_code==401
        assert 'アプリ用パスワード' in client.get('/login').text
        assert client.get('/backend/app.py').status_code==404
        assert client.get('/sw.js').status_code==404
        assert client.get('/styles.css').status_code==200


def test_login_remember_cookie_headers_api_and_logout():
    with TestClient(app(),base_url=ORIGIN) as client:
        response=login(client)
        assert response.status_code==200
        header=response.headers['set-cookie']
        assert 'HttpOnly' in header and 'Secure' in header and 'SameSite=strict' in header
        assert f'Max-Age={REMEMBER_SECONDS}' in header and 'Domain=' not in header
        assert PASSWORD not in header and KEY not in header
        assert client.get('/api/snapshot').json()['snapshot']['soc']==64
        html=client.get('/')
        assert 'data-session-app="true"' in html.text
        assert html.headers['cache-control']=='no-store'
        assert "frame-ancestors 'none'" in html.headers['content-security-policy']
        assert client.post('/auth/logout',headers={'Origin':ORIGIN}).status_code==200
        assert client.get('/auth/session').status_code==401
        assert client.get('/',follow_redirects=False).status_code==303


def test_non_remembered_cookie_is_browser_session_only():
    with TestClient(app(),base_url=ORIGIN) as client:
        assert 'Max-Age' not in login(client,False).headers['set-cookie']


def test_csrf_missing_origin_and_cross_origin_requests_are_denied():
    with TestClient(app(),base_url=ORIGIN) as client:
        body={'password':PASSWORD}
        assert client.post('/auth/login',json=body).status_code==403
        assert client.post('/auth/login',json=body,headers={'Origin':'https://evil.invalid'}).status_code==403
        assert login(client).status_code==200
        assert client.post('/auth/logout',headers={'Origin':'https://haniojp.github.io'}).status_code==403
        assert client.get('/api/snapshot',headers={'Origin':'https://evil.invalid'}).status_code==403
        assert client.get('/api/snapshot',headers={'Origin':'https://haniojp.github.io'}).json()['code']=='APP_LOGIN_REQUIRED'
        preflight=client.options('/api/snapshot',headers={'Origin':'https://haniojp.github.io','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'})
        assert preflight.status_code==204 and preflight.headers['access-control-allow-origin']=='https://haniojp.github.io'
        assert 'access-control-allow-credentials' not in preflight.headers


def test_login_validation_never_echoes_password_and_rate_limit():
    with TestClient(app(),base_url=ORIGIN) as client:
        response=client.post('/auth/login',json={'password':PASSWORD,'unexpected':PASSWORD},headers={'Origin':ORIGIN})
        assert response.status_code==422 and PASSWORD not in response.text
        for _ in range(5):assert login(client,password='incorrect').status_code==401
        response=login(client)
        assert response.status_code==429 and PASSWORD not in response.text


def test_cookie_expiry_tampering_and_server_restart_password_change():
    auth=SessionAuth(PASSWORD,KEY)
    token=auth.issue(3600)
    assert auth.valid(token)
    assert SessionAuth(PASSWORD,KEY).valid(token)  # survives Render restart without a database
    assert not SessionAuth(PASSWORD+'changed',KEY).valid(token)
    assert not SessionAuth(PASSWORD,KEY+'changed').valid(token)
    assert not auth.valid(token+'tampered')
    assert not auth.valid('invalid')
    with patch('backend.session_auth.time.time',return_value=time.time()+3601):assert not auth.valid(token)


def test_settings_require_strong_login_password_and_exact_origin(monkeypatch):
    env={'BRIDGE_ACCESS_KEY':KEY,'ALLOWED_ORIGIN':'https://haniojp.github.io','PORSCHE_EMAIL':'owner','PORSCHE_PASSWORD':'secret','APP_LOGIN_PASSWORD':PASSWORD,'APP_ORIGIN':'https://macan-control-api.onrender.com'}
    for key,value in env.items():monkeypatch.setenv(key,value)
    assert Settings.from_env().app_origin==env['APP_ORIGIN']
    monkeypatch.setenv('APP_LOGIN_PASSWORD','short')
    with pytest.raises(RuntimeError):Settings.from_env()
