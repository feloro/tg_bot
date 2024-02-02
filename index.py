import telebot
import bot
from triggerPayload import TriggerPayload
import triggers as triggers
import json

def handler(event, _):
    triggerPayload = None
    try:
        payloadStr = event['details']['payload']
        payload = json.loads(payloadStr)
        triggerPayload = TriggerPayload(**payload)
    except Exception as inst:
        print(inst)
        
    if triggerPayload is not None:
        if triggerPayload.triggerMethodName == "sendInfoToAll":
            bot.sendInfoToAll(triggerPayload.matchId)
        elif triggerPayload.triggerMethodName == "createTriggers":
            triggers.createTriggers()
    else:
        message = telebot.types.Update.de_json(event['body'])
        bot.bot.process_new_updates([message])
    return {
        'statusCode': 200,
        'body': '!',
    }