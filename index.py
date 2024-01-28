#  Copyright (c) ChernV (@otter18), 2021.

import telebot
import bot
from pydantic import BaseModel

class TriggerPayload(BaseModel):
    triggerMethodName: str

def handler(event, _):
    print(event)
    try:
        triggerPayload = TriggerPayload(**event)
        sendMessageToAll()
    except Exception:
        message = telebot.types.Update.de_json(event['body'])
        bot.bot.process_new_updates([message])
        return {
            'statusCode': 200,
            'body': '!',
        }

def sendMessageToAll():
    bot.sendInfoToAll()
    return {
        'statusCode': 200,
        'body': '!',
    }