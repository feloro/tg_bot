import telebot
import request
from datetime import date
import sys

apiKey = sys.argv[1]
bot = telebot.TeleBot(apiKey)


@bot.message_handler(content_types=['text'])
def get_text_messages(message):
    if message.text == "Привет":
        games = request.downloadGames()
        request.getFinishedGames(games)
        bot.send_message(message.from_user.id,
                         "Привет, чем я могу тебе помочь?" + str(len(request.getFinishedGames(games))))
    elif message.text == "/help":
        bot.send_message(message.from_user.id, "Напиши привет")
    elif message.text == "/today":
        games = request.downloadGames()
        today = date.today()
        responseText = ""
        for game in request.getGames(today.strftime("%Y-%m-%d"), games):
            videoUrl = game.videoUrl() or "Отсутствует"
            responseText += game.competitors[0].teamName + " - " + game.competitors[1].teamName + " Ссылка на трансляцию: " + videoUrl + "\n"
        bot.send_message(message.from_user.id, responseText)
    else:
        bot.send_message(message.from_user.id,
                         "Я тебя не понимаю. Напиши /help.")
bot.polling(none_stop=True, interval=0)