import os
import telebot
import request
import db
from datetime import date, timedelta

bot = telebot.TeleBot(os.environ.get('BOT_TOKEN'))
                         
@bot.message_handler(commands=['today'])
def send_today_games(message):
    games = request.downloadGames()
    today = date.today()
    responseText = "Игры на сегодня:"
    responseText += formatGames(request.getGames(today, today, games), False)
    bot.send_message(message.from_user.id, responseText, parse_mode= 'Markdown')

@bot.message_handler(commands=['soon'])
def sendSoonGames(message):
    games = request.downloadGames()
    today = date.today()
    dateEnd = today + timedelta(days=5)
    responseText = "Игры в ближайшие 5 дней:"
    responseText += formatGames(request.getGames(today, dateEnd, games), False)
    bot.send_message(message.from_user.id, responseText, parse_mode= 'Markdown')
    
@bot.message_handler(commands=['past'])
def sendTodayGames(message):
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
    if db.getUser(message.from_user.id) is None:
        db.createUser(message.from_user.id)
    bot.send_message(message.from_user.id, "Ваш пользователь добавлен в рассылку", parse_mode= 'Markdown')  

@bot.message_handler(commands=['unregister'])
def addUserIdToDB(message):
    db.removeUser(message.from_user.id)
    bot.send_message(message.from_user.id, "Ваш пользователь убран из рассылки", parse_mode= 'Markdown')   

@bot.message_handler(content_types=['text'])
def getTextMessages(message):
    responseText = "Для получения справки воспользуйтесь коммандой - /help"
    bot.send_message(message.from_user.id, responseText)

def sendInfoToAll():
    users = db.getUsers()
    for user in users:
        print(user)
        if user is not None:
            bot.send_message(user.user_id, "Успех?")   
    
def formatGames(games, withScore):
    responseText = ""
    for game in games:
        if game.videoUrl() is not None :
            videoUrl = "[Ссылка]({})".format(game.videoUrl())
        else:
            videoUrl = "Отсутствует"
        if game.competitors[0].isHomeCompetitor:
            homeCompetitor = game.competitors[0]
            guestCompetitor = game.competitors[1]
        else:
            homeCompetitor = game.competitors[1]
            guestCompetitor = game.competitors[0]
        timeStart = game.startTime() or ""
        responseText += "\n*{}* - *{}* \n*Начало матча:* {} \n*Ссылка на транляцию:* {}".format(homeCompetitor.teamName, guestCompetitor.teamName, timeStart, videoUrl)
        if withScore:
            responseText += "\nCчет: ||{} : {}||".format(homeCompetitor.scoreString, guestCompetitor.scoreString)
        responseText += "\n\n"
    return responseText

if __name__ == '__main__':
    # sendInfoToAll()
    bot.infinity_polling()
