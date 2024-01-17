import requests

from pydantic import BaseModel, validator
from typing import Optional, List
from datetime import date

class Competitor(BaseModel):
    isHomeCompetitor: bool
    scoreString: int
    teamName: str
    teamId: int

class VideoLinks(BaseModel):
    videoM3U8: str

class Game(BaseModel):
    competitionId: int
    matchId: int
    matchStatus: str
    matchTimeMsk: str
    video: Optional[VideoLinks] = None
    competitors: List[Competitor] = []

    def videoUrl(self):
        if self.video is not None:
            return self.video.videoM3U8 or None
        else:
            return None

def downloadGames():
    games = []
    url = "https://api.vtb-league.com/a49755699622d8fe2d87e6d2ac24a7bb/v1/competitions/games?limit=500"
    payload = {"limit": 500}
    response = requests.get(url, params=payload)
    response_json = response.json()

    for game in response_json["data"]:
        games.append(Game(**game))
    return games

def getFinishedGames(games):
    return list(filter(lambda game: game.matchStatus == "COMPLETE", games))

def getGames(date, games):
    return list(filter(lambda game: game.matchTimeMsk.startswith(date), games))



# games = downloadGames()
# print(len(getFinishedGames(games)))

# today = date.today()
# print(len(getGames(today.strftime("%Y-%m-%d"), games)))
# print(len(games))