import request
import requests
from datetime import date, timedelta, datetime
from pydantic import BaseModel
from triggerPayload import TriggerPayload
import os

SERVICE_ACCOUNT_ID = os.environ.get('SERVICE_ACCOUNT_ID')
SERVELESS_FUNCTION_ID = os.environ.get('SERVELESS_FUNCTION_ID')
FOLDER_ID = os.environ.get('FOLDER_ID')

class InvokeFunction(BaseModel):
    functionId: str = SERVELESS_FUNCTION_ID
    functionTag: str = "$latest"
    serviceAccountId: str = SERVICE_ACCOUNT_ID

class Timer(BaseModel):
    cronExpression: str = ""
    payload: str = ""
    invokeFunction: InvokeFunction = InvokeFunction()

class Rule(BaseModel):
    timer: Timer = Timer()

class Trigger(BaseModel):
    folderId: str = FOLDER_ID
    name: str = ""
    rule: Rule = Rule()

    def __init__(self, cron, payload, name):
        super().__init__()
        self.name = name
        self.rule.timer.payload = payload
        self.rule.timer.cronExpression = cron

def createTriggers():
    accessToken = generateIAMToken()
    deleteAutoTriggers(accessToken)

    games = request.downloadGames()
    today = date.today() + timedelta(days=-5)
    todayGames = request.getGames(today, today, games)

    
    for game in todayGames:
        parsedGameTime = datetime.strptime(game.matchTimeMsk, "%Y-%m-%d %H:%M:%S")
        parsedGameTime = parsedGameTime + timedelta(minutes=-15)
        cronTime = parsedGameTime.strftime("%M %H ? * * *")

        payload = TriggerPayload(triggerMethodName="sendInfoToAll", matchId=game.matchId).model_dump_json()
        trigger = Trigger(
            cron=cronTime,
            payload=payload,
            name="autotrigger-for-{}".format(game.matchId)
        ).model_dump_json()
        
        headers = {'Authorization' : 'Bearer {}'.format(accessToken)}
        requests.post("https://serverless-triggers.api.cloud.yandex.net/triggers/v1/triggers", data = trigger, headers = headers)
        
def generateIAMToken():
    url = 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token'
    headers = {'Metadata-Flavor': 'Google'}
    resp = requests.get(url, headers=headers).json()
    return resp['access_token']

def deleteAutoTriggers(accessToken):
    listUrl = "https://serverless-triggers.api.cloud.yandex.net/triggers/v1/triggers"
    parameters = {"folderId": FOLDER_ID}
    headers = {'Authorization' : 'Bearer {}'.format(accessToken)}
    resp = requests.get(url=listUrl, params=parameters, headers=headers)
    triggers = resp.json()['triggers']

    for trigger in triggers:
        if trigger['name'].startswith('autotrigger-for-'):
            deleteUrl = "https://serverless-triggers.api.cloud.yandex.net/triggers/v1/triggers/{}".format(trigger["id"])
            resp = requests.delete(url=deleteUrl, headers=headers)