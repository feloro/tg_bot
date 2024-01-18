import os
import telebot
import request
from datetime import date
import sys

bot = telebot.TeleBot(os.environ.get('BOT_TOKEN'))
                         
@bot.message_handler(commands=['today'])
def send_today_games(message):
    games = request.downloadGames()
    today = date.today()
    responseText = ""
    for game in request.getGames(today.strftime("%Y-%m-%d"), games):
        videoUrl = game.videoUrl() or "Отсутствует"
        responseText += game.competitors[0].teamName + " - " + game.competitors[1].teamName + " Ссылка на трансляцию: " + videoUrl + "\n"
    bot.send_message(message.from_user.id, responseText)

@bot.message_handler(content_types=['text'])
def get_text_messages(message):
    if message.text == "Привет":
        games = request.downloadGames()
        request.getFinishedGames(games)
        bot.send_message(message.from_user.id,
                         "Привет, чем я могу тебе помочь?" + str(len(request.getFinishedGames(games))))
    elif message.text == "/help":
        bot.send_message(message.from_user.id, "Напиши привет")
    else:
        bot.send_message(message.from_user.id,
                         "Я тебя не понимаю. Напиши /help.")

if __name__ == '__main__':
    bot.infinity_polling()
