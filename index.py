#  Copyright (c) ChernV (@otter18), 2021.

import telebot
import bot
from pydantic import BaseModel
import json

class TriggerPayload(BaseModel):
    triggerMethodName: str
    matchId: int

def handler(event, _):
    triggerPayload = None
    try:
        payloadStr = event['details']['payload']
        payload = json.loads(payloadStr)
        triggerPayload = TriggerPayload(**payload)
    except Exception as inst:
        print(inst)
        
    if triggerPayload is not None:
        bot.sendInfoToAll(triggerPayload.matchId)
    else:
        message = telebot.types.Update.de_json(event['body'])
        bot.bot.process_new_updates([message])
    return {
        'statusCode': 200,
        'body': '!',
    }