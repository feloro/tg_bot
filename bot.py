import os
import telebot
import request
import db
import logging
import time
import datetime
from pythonjsonlogger import jsonlogger
from datetime import date, timedelta

bot = telebot.TeleBot(os.environ.get('BOT_TOKEN'))
                         
class YcLoggingFormatter(jsonlogger.JsonFormatter):
    def add_fields(self, log_record, record, message_dict):
        super(YcLoggingFormatter, self).add_fields(log_record, record, message_dict)
        log_record['logger'] = record.name
        log_record['level'] = str.replace(str.replace(record.levelname, "WARNING", "WARN"), "CRITICAL", "FATAL")

logHandler = logging.StreamHandler()
logHandler.setFormatter(YcLoggingFormatter('%(message)s %(level)s %(logger)s'))

logger = logging.getLogger('MyLogger')
logger.propagate = False
logger.addHandler(logHandler)
logger.setLevel(logging.DEBUG)


@bot.message_handler(commands=['today'])
def send_today_games(message):
    username = message.from_user.username
    timestamp = datetime.datetime.fromtimestamp(time.time())
    logMessage = "function {} by {} at {}".format(message.text, username, timestamp)

    logger.info(logMessage)
    games = request.downloadGames()
    today = date.today()
    
    responseText = "Игры на сегодня:"
    responseText += formatGames(request.getGames(today, today, games), False)
    bot.send_message(message.from_user.id, responseText, parse_mode= 'Markdown')

@bot.message_handler(commands=['soon'])
def sendSoonGames(message):
    username = message.from_user.username
    timestamp = datetime.datetime.fromtimestamp(time.time())
    logMessage = "function {} by {} at {}".format(message.text, username, timestamp)

    logger.info(logMessage)
    games = request.downloadGames()
    today = date.today()
    dateEnd = today + timedelta(days=5)
    responseText = "Игры в ближайшие 5 дней:"
    responseText += formatGames(request.getGames(today, dateEnd, games), False)
    bot.send_message(message.from_user.id, responseText, parse_mode= 'Markdown')
    
@bot.message_handler(commands=['past'])
def sendTodayGames(message):
    username = message.from_user.username
    timestamp = datetime.datetime.fromtimestamp(time.time())
    logMessage = "function {} by {} at {}".format(message.text, username, timestamp)

    logger.info(logMessage)
    games = request.downloadGames()
    today = date.today()
    startDate = today + timedelta(days=-5)
    responseText = "Игры за прошедшие 5 дней:"
    responseText += formatGames(request.getGames(startDate, today, games), True).replace('-', r'\-').replace('.', r'\.')
    bot.send_message(message.from_user.id, responseText, parse_mode= 'MarkdownV2')

@bot.message_handler(commands=['help'])
def sendHelp(message):
    games = request.downloadGames()
    today = date.today()
    responseText = """Для того, чтобы получить список матчей на сегодня - /today\nCписок матчей на 5 дней вперед - /soon\nСписок матчей за последние 5 дней - /past"""
    bot.send_message(message.from_user.id, responseText)

@bot.message_handler(commands=['register'])
def addUserIdToDB(message):
    username = message.from_user.username
    timestamp = datetime.datetime.fromtimestamp(time.time())
    logMessage = "function {} by {} at {}".format(message.text, username, timestamp)

    logger.info(logMessage)
    print("try to add user")
    if db.getUser(message.from_user.id) is None:
        db.createUser(message.from_user.id)
    else:
        print("No user")
    bot.send_message(message.from_user.id, "Ваш пользователь добавлен в рассылку", parse_mode= 'Markdown')  

@bot.message_handler(commands=['unregister'])
def addUserIdToDB(message):
    username = message.from_user.username
    timestamp = datetime.datetime.fromtimestamp(time.time())
    logMessage = "function {} by {} at {}".format(message.text, username, timestamp)

    logger.info(logMessage)
    db.removeUser(message.from_user.id)
    bot.send_message(message.from_user.id, "Ваш пользователь убран из рассылки", parse_mode= 'Markdown')   

@bot.message_handler(content_types=['text'])
def getTextMessages(message):
    responseText = "Для получения справки воспользуйтесь коммандой - /help"
    bot.send_message(message.from_user.id, responseText)

def sendInfoToAll(matchId):
    users = db.getUsers()
    games = request.downloadGames() 
    neededGame = next((item for item in games if item.matchId == matchId), None)
    if neededGame is not None:
        for user in users:
            if user is not None:
                bot.send_message(user.user_id, formatGames([neededGame], False), parse_mode= 'Markdown')   
    
def formatGames(games, withScore):
    responseText = ""
    for game in games:
        if game.videoUrl() is not None :
            videoUrl = "[Ссылка]({})".format(game.videoUrl())
        else:
            videoUrl = "Отсутствует"
        timeStart = game.startTime() or ""
        if game.competitors is not None:
            if game.competitors[0].isHomeCompetitor:
                homeCompetitor = game.competitors[0]
                guestCompetitor = game.competitors[1]
            else:
                homeCompetitor = game.competitors[1]
                guestCompetitor = game.competitors[0]
            responseText += "\n*{}* - *{}* \n*Начало матча:* {} \n*Ссылка на транляцию:* {}".format(homeCompetitor.teamName.ru or "TBA", guestCompetitor.teamName.ru or "TBA", timeStart, videoUrl)
            if withScore:
                responseText += "\nCчет: ||{} : {}||".format(homeCompetitor.scoreString, guestCompetitor.scoreString)
        else:
                responseText += "\n*TBA* - *TBA* \n*Начало матча:* {} \n*Ссылка на транляцию:* {}".format(timeStart, videoUrl)
        responseText += "\n\n"
    return responseText

if __name__ == '__main__':
    # sendInfoToAll()
    bot.infinity_polling()
