import os
import telebot
import request
from datetime import date, timedelta
import sys

bot = telebot.TeleBot(os.environ.get('BOT_TOKEN'))
                         
@bot.message_handler(commands=['today'])
def send_today_games(message):
    games = request.downloadGames()
    today = date.today()
    responseText = "Игры на сегодня:"
    responseText += formatGames(request.getGames(today, today, games))
    bot.send_message(message.from_user.id, responseText, parse_mode= 'Markdown')
    
@bot.message_handler(commands=['soon'])
def send_today_games(message):
    games = request.downloadGames()
    today = date.today()
    dateEnd = today + timedelta(days=5)
    responseText = "Игры в ближайшие 5 дней:"
    responseText += formatGames(request.getGames(today, dateEnd, games))
    bot.send_message(message.from_user.id, responseText, parse_mode= 'Markdown')

@bot.message_handler(commands=['help'])
def send_today_games(message):
    games = request.downloadGames()
    today = date.today()
    responseText = """Для того, чтобы получить список матчей на сегодня - /today\nCписок матчей на 5 дней вперед - /soon"""
    bot.send_message(message.from_user.id, responseText)

@bot.message_handler(content_types=['text'])
def get_text_messages(message):
    responseText = "Для получения справки воспользуйтесь коммандой - /help"
    bot.send_message(message.from_user.id, responseText)
    
    
def formatGames(games):
    responseText = ""
    for game in games:
        if game.videoUrl() is not None :
            videoUrl = "[Ссылка]({})".format(game.videoUrl())
        else:
            videoUrl = "Отсутствует"
        homeCompetitor: Competitor
        guestCompetitor: Competitor
        if game.competitors[0].isHomeCompetitor:
            homeCompetitor = game.competitors[0].teamName
            guestCompetitor = game.competitors[1].teamName
        else:
            homeCompetitor = game.competitors[1].teamName
            guestCompetitor = game.competitors[0].teamName
        timeStart = game.startTime() or ""
        responseText += '''\n*{}* - *{}* \n*Начало матча:* {} \n*Ссылка на транляцию:* {}\n\n'''.format(homeCompetitor, guestCompetitor, timeStart, videoUrl)
    return responseText

if __name__ == '__main__':
    bot.infinity_polling()
