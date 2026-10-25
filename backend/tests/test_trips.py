from types import SimpleNamespace

import pytest
from pyporscheconnectapi.exceptions import PorscheExceptionError

from backend.provider import PorscheProvider
from backend.trips import TRIP_MEASUREMENTS, normalize_trips

STAMP='2026-10-25T01:00:00Z'


def trip_payload():
    return {'vin':'DO-NOT-EXPOSE', 'access_token':'private', 'measurements':[
        {'key':key,'status':{'isEnabled':True},'value':{
            'distanceKm':62.4,'avgKwhPerHundredKm':20,'drivingTimeMinutes':90,
            'avgSpeedKmh':41.6,'tripEndTime':STAMP,'GPS_LOCATION':'private-location'}}
        for key in TRIP_MEASUREMENTS]}


def test_trip_periods_units_and_private_fields():
    result=normalize_trips(trip_payload(),STAMP)
    assert result['status']=='available'
    assert set(result['periods'])=={'shortTerm','longTerm','sinceCharge'}
    assert result['periods']['shortTerm']=={'distanceKm':62.4,'averageConsumptionKwhPer100Km':20,'drivingTimeMinutes':90,'averageSpeedKmh':41.6,'tripEndTime':STAMP}
    assert 'private' not in str(result) and 'DO-NOT-EXPOSE' not in str(result)


@pytest.mark.parametrize('value',[None,'20',True,{},[],float('nan'),float('inf'),10**1000])
def test_invalid_metrics_do_not_become_zero(value):
    raw=trip_payload()
    for item in raw['measurements']:
        for key in ('distanceKm','avgKwhPerHundredKm','drivingTimeMinutes','avgSpeedKmh'):
            item['value'][key]=value
    result=normalize_trips(raw,STAMP)
    assert result['status']=='unavailable'
    assert all(row is None for row in result['periods'].values())


def test_zero_negative_missing_and_no_estimates():
    raw=trip_payload();short=raw['measurements'][0]['value']
    short.update(distanceKm=0,avgKwhPerHundredKm=0,drivingTimeMinutes=0,avgSpeedKmh=0)
    assert normalize_trips(raw,STAMP)['periods']['shortTerm']['averageConsumptionKwhPer100Km']==0
    short.update(avgKwhPerHundredKm=-2,distanceKm=-1)
    row=normalize_trips(raw,STAMP)['periods']['shortTerm']
    assert row['averageConsumptionKwhPer100Km']==-2 and row['distanceKm'] is None
    short.pop('avgSpeedKmh');short['tripEndTime']='invalid'
    row=normalize_trips(raw,STAMP)['periods']['shortTerm']
    assert row['averageSpeedKmh'] is None and row['tripEndTime'] is None


def test_unsupported_or_disabled_periods_and_units():
    raw=trip_payload();raw['measurements'][0]['status']['isEnabled']=False
    raw['measurements'][1]['value']={'averageSpeed':{'value':50,'unit':'mph'}}
    raw['measurements'][2]['value']=None
    result=normalize_trips(raw,STAMP)
    assert result['status']=='unavailable'
    assert normalize_trips({},STAMP)['status']=='error'
    assert normalize_trips({'measurements':[]},STAMP)['status']=='unavailable'


@pytest.mark.asyncio
@pytest.mark.parametrize('failure',[PorscheExceptionError(404,response_body='private-raw-error'),TimeoutError(),ValueError('private-error')])
async def test_optional_trip_failure_keeps_vehicle_data_and_cache(failure):
    calls=[]
    async def get(path,params=None):
        calls.append(params)
        if params==[('mf',key) for key in TRIP_MEASUREMENTS]:
            raise failure
        return {'measurements':[{'key':'BATTERY_LEVEL','status':{'isEnabled':True},'value':{'percent':78}}]}
    connection=SimpleNamespace(get=get,oauth2_client=SimpleNamespace(captcha=None))
    provider=PorscheProvider('owner','secret','WP0ZZZ95ZLS000001',connection)
    result=await provider.snapshot()
    assert result['snapshot']['soc']==78
    assert result['tripStatistics']['status']=='error'
    assert 'private' not in str(result)
    assert await provider.snapshot()==result and len(calls)==2


@pytest.mark.asyncio
async def test_optional_trip_success():
    async def get(path,params=None):
        if params==[('mf',key) for key in TRIP_MEASUREMENTS]:return trip_payload()
        return {'measurements':[{'key':'BATTERY_LEVEL','status':{'isEnabled':True},'value':{'percent':78}}]}
    connection=SimpleNamespace(get=get,oauth2_client=SimpleNamespace(captcha=None))
    result=await PorscheProvider('owner','secret','WP0ZZZ95ZLS000001',connection).snapshot()
    assert result['tripStatistics']['periods']['shortTerm']['averageSpeedKmh']==41.6
