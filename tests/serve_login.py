"""Local HTTPS integration fixture. No real Porsche credentials or network calls."""
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import uvicorn
from backend.app import Settings,create_app


class Provider:
    async def snapshot(self,**kwargs):
        return {'schemaVersion':1,'fetchedAt':'2026-10-26T01:00:00Z','vehicleTimestamp':None,
                'snapshot':{'timestamp':'2026-10-26T01:00:00Z','soc':64,'rangeKm':280,'odometerKm':9000,'chargingStatus':'充電中','source':'api'}}
    async def close(self):pass


if __name__=='__main__':
    with tempfile.TemporaryDirectory(prefix='macan-login-test-') as directory:
        key=str(Path(directory)/'key.pem');cert=str(Path(directory)/'cert.pem')
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        app=create_app(Settings('test-bridge-key-'+('x'*40),'http://127.0.0.1:8000','test','test','',
                                'test-app-password-12345','https://127.0.0.1:8444'),Provider())
        uvicorn.run(app,host='127.0.0.1',port=8444,ssl_keyfile=key,ssl_certfile=cert,access_log=False,log_level='warning')
