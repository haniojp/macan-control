import asyncio
from copy import deepcopy
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from pyporscheconnectapi.exceptions import PorscheCaptchaRequiredError, PorscheExceptionError, PorscheWrongCredentialsError

from backend.app import Settings, create_app
from backend.provider import BridgeError, MEASUREMENTS, PorscheProvider, normalize

VIN='WP0ZZZ95ZLS000001'
STAMP='2026-10-24T00:00:00Z'
KEY='x'*48
ORIGIN='https://haniojp.github.io'


def payload():
    return {'vin':VIN,'GPS_LOCATION':{'latitude':35},'access_token':'must-not-leak', 'measurements':[
        {'key':key,'status':{'isEnabled':True},'value':value} for key,value in [
            ('BATTERY_LEVEL',{'percent':78}),('E_RANGE',{'kilometers':312}),
            ('MILEAGE',{'kilometers':8420}),('CHARGING_SUMMARY',{'status':'CHARGING','mode':'DIRECT'}),
            ('GLOBAL_TIMESTAMP',{'timestamp':STAMP}),('GPS_LOCATION',{'latitude':35})]]}


def test_normalize_allowlist_and_timestamp():
    result=normalize(payload(),STAMP)
    assert result['snapshot']=={'timestamp':STAMP,'soc':78,'rangeKm':312,'odometerKm':8420,'chargingStatus':'充電中','source':'api'}
    assert result['vehicleTimestamp']==STAMP
    assert VIN not in str(result) and 'latitude' not in str(result) and 'must-not-leak' not in str(result)


@pytest.mark.parametrize('value',[None,True,-1,101,float('nan'),'78',{},[]])
def test_invalid_soc_is_missing_not_zero(value):
    raw=payload();raw['measurements'][0]['value']['percent']=value
    assert normalize(raw,STAMP)['snapshot']['soc'] is None


def test_disabled_and_missing_fields_no_invented_defaults():
    raw=payload();raw['measurements'][0]['status']['isEnabled']=False
    raw['measurements'][3]['value']={'mode':'DIRECT'}
    raw['measurements'][4]['value']={'timestamp':'not-a-date'}
    result=normalize(raw,STAMP)
    assert result['snapshot']['soc'] is None
    assert result['snapshot']['chargingStatus'] is None
    assert result['vehicleTimestamp'] is None
    assert result['snapshot']['timestamp']==STAMP
    with pytest.raises(BridgeError,match='NO_VEHICLE_DATA'):
        normalize({'measurements':[]},STAMP)


def test_range_fallback_and_zero_values():
    raw={'measurements':[{'key':key,'status':{'isEnabled':True},'value':value} for key,value in [('BATTERY_LEVEL',{'percent':0}),('RANGE',{'kilometers':0}),('MILEAGE',{'kilometers':0})]]}
    result=normalize(raw,STAMP)['snapshot']
    assert result['soc']==0 and result['rangeKm']==0 and result['odometerKm']==0


class Connection:
    def __init__(self):
        self.calls=[]
        self.fail=None
        self.oauth2_client=SimpleNamespace(captcha=None,code_verifier=None)
        self.closed=False
    async def get(self,path,params=None):
        self.calls.append((path,params))
        if self.fail:raise self.fail
        return [{'vin':VIN}] if path=='/connect/v1/vehicles' else deepcopy(payload())
    async def close(self):self.closed=True


@pytest.mark.asyncio
async def test_read_only_measurements_cache_and_single_flight():
    conn=Connection();p=PorscheProvider('owner','secret',connection=conn)
    a,b=await asyncio.gather(p.snapshot(),p.snapshot())
    assert a==b and len(conn.calls)==3
    assert conn.calls[1][1]==[('mf',key) for key in MEASUREMENTS]
    assert all('wakeUpJob' not in path and 'GPS' not in str(params) for path,params in conn.calls)
    await p.close();assert conn.closed


@pytest.mark.asyncio
@pytest.mark.parametrize('exc,code',[(PorscheWrongCredentialsError('raw-secret'),'AUTH_REQUIRED'),(PorscheExceptionError(401,response_body='raw-secret'),'AUTH_REQUIRED'),(PorscheExceptionError(429),'UPSTREAM_RATE_LIMIT'),(TimeoutError(),'PORSCHE_TIMEOUT'),(RuntimeError('raw-secret'),'PORSCHE_UNAVAILABLE')])
async def test_errors_are_sanitized_and_retries_back_off(exc,code):
    conn=Connection();conn.fail=exc;p=PorscheProvider('owner','secret',VIN,conn)
    with pytest.raises(BridgeError) as err:await p.snapshot()
    assert err.value.code==code and 'raw-secret' not in str(err.value)
    with pytest.raises(BridgeError,match='RETRY_LATER'):await p.snapshot()
    assert len(conn.calls)==1


@pytest.mark.asyncio
async def test_captcha_state_stays_server_side_and_resumes():
    conn=Connection();image='data:image/png;base64,YQ=='
    conn.fail=PorscheCaptchaRequiredError(captcha=image,state='private-state',code_verifier='private-verifier')
    p=PorscheProvider('owner','secret',VIN,conn)
    with pytest.raises(BridgeError) as err:await p.snapshot()
    assert err.value.code=='CAPTCHA_REQUIRED' and err.value.image==image
    with pytest.raises(BridgeError,match='CAPTCHA_REQUIRED'):await p.snapshot()
    assert len(conn.calls)==1
    conn.fail=None
    await p.snapshot(captcha_code='ABCD')
    assert conn.oauth2_client.code_verifier=='private-verifier'
    assert conn.oauth2_client.captcha.captcha_code is None


@pytest.mark.asyncio
async def test_multiple_vehicles_requires_server_selection():
    conn=Connection()
    async def many(*args,**kwargs):return [{'vin':VIN},{'vin':VIN}]
    conn.get=many
    with pytest.raises(BridgeError,match='SELECT_VEHICLE'):
        await PorscheProvider('owner','secret',connection=conn).snapshot()


class Provider:
    def __init__(self):self.calls=0;self.error=None
    async def snapshot(self,**kwargs):
        self.calls+=1
        if self.error:raise self.error
        return normalize(payload(),STAMP)
    async def close(self):pass


def client():
    provider=Provider()
    return TestClient(create_app(Settings(KEY,ORIGIN,'owner','secret'),provider)),provider


def test_http_auth_cors_no_store_and_no_command_routes():
    api,p=client()
    with api:
        assert api.get('/healthz').json()=={'status':'ok'}
        assert api.get('/api/snapshot').status_code==401
        assert api.get('/api/snapshot',headers={'Authorization':'Bearer wrong'}).status_code==401
        assert p.calls==0
        headers={'Authorization':'Bearer '+KEY,'Origin':ORIGIN}
        result=api.get('/api/snapshot',headers=headers)
        assert result.status_code==200
        assert result.headers['cache-control']=='no-store'
        assert result.headers['access-control-allow-origin']==ORIGIN
        assert 'access-control-allow-credentials' not in result.headers
        assert api.get('/api/snapshot',headers={**headers,'Origin':'https://evil.invalid'}).status_code==403
        assert p.calls==1
        assert api.post('/api/snapshot',headers=headers).status_code==405
        assert api.post('/api/unlock',headers=headers).status_code==404
        assert api.get('/docs').status_code==404


def test_preflight_and_safe_error_body():
    api,p=client()
    with api:
        response=api.options('/api/snapshot',headers={'Origin':ORIGIN,'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization'})
        assert response.status_code==200 and p.calls==0
        p.error=BridgeError('CAPTCHA_REQUIRED',409,'data:image/png;base64,YQ==')
        result=api.get('/api/snapshot',headers={'Authorization':'Bearer '+KEY,'Origin':ORIGIN})
        assert result.status_code==409
        assert result.json()=={'code':'CAPTCHA_REQUIRED','captchaImage':'data:image/png;base64,YQ=='}
        assert result.headers['cache-control']=='no-store'
        assert api.post('/api/auth/captcha',json={'code':'A','state':'injected'},headers={'Authorization':'Bearer '+KEY}).status_code==422


def test_settings_fail_closed(monkeypatch):
    for name in ['BRIDGE_ACCESS_KEY','PORSCHE_EMAIL','PORSCHE_PASSWORD','ALLOWED_ORIGIN']:
        monkeypatch.delenv(name,raising=False)
    with pytest.raises(RuntimeError):Settings.from_env()
    for k,v in {'BRIDGE_ACCESS_KEY':KEY,'PORSCHE_EMAIL':'owner','PORSCHE_PASSWORD':'secret','ALLOWED_ORIGIN':ORIGIN}.items():monkeypatch.setenv(k,v)
    assert Settings.from_env().allowed_origin==ORIGIN
    monkeypatch.setenv('ALLOWED_ORIGIN',ORIGIN+'/macan-control/')
    with pytest.raises(RuntimeError):Settings.from_env()

@pytest.mark.parametrize('status,expected',[('NOT_PLUGGED','未接続'),('CHARGING_COMPLETED','充電完了'),('UNKNOWN',None)])
def test_observed_charging_statuses(status,expected):
    raw=payload();raw['measurements'][3]['value']['status']=status
    assert normalize(raw,STAMP)['snapshot']['chargingStatus']==expected


@pytest.mark.asyncio
async def test_installed_sdk_request_contract_with_mock_transport():
    import time
    from pyporscheconnectapi.connection import Connection as SDKConnection
    requests=[]
    def upstream(request):
        requests.append(request)
        assert request.method=='GET'
        assert request.headers['authorization']=='Bearer fake-upstream-token'
        if request.url.path.endswith('/vehicles'):
            return httpx.Response(200,json=[{'vin':VIN}])
        from backend.trips import TRIP_MEASUREMENTS
        if request.url.params.get_list('mf')==list(TRIP_MEASUREMENTS):
            return httpx.Response(200,json={'measurements':[]})
        assert request.url.params.get_list('mf')==list(MEASUREMENTS)
        assert 'wakeUpJob' not in request.url.params
        return httpx.Response(200,json=payload())
    client=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    connection=SDKConnection(async_client=client,token={'access_token':'fake-upstream-token','refresh_token':'fake-refresh','expires_at':int(time.time())+3600})
    provider=PorscheProvider('owner','secret',connection=connection)
    result=await provider.snapshot()
    assert result['snapshot']['soc']==78 and len(requests)==3
    assert result['tripStatistics']['status']=='unavailable'
    await provider.close()
