import requests

from pydantic import BaseModel, validator
from typing import Optional, List, overload
from datetime import date, datetime

class Competitor(BaseModel):
    isHomeCompetitor: bool
    scoreString: int
    teamName: str
    teamId: int

class VideoLinks(BaseModel):
    videoM3U8: str
    videoForWebview: str
    videoIdFrame: str

class Game(BaseModel):
    competitionId: int
    matchId: int
    matchStatus: str
    matchTimeMsk: str
    video: Optional[VideoLinks] = None
    competitors: List[Competitor] = []

    def videoUrl(self):
        if self.video is not None:
            baseUrl = self.video.videoForWebview.replace(self.video.videoIdFrame,"")
            path = self.video.videoM3U8.split("/start/",1)[1]
            path = path.replace(".m3u8","")
            return baseUrl+path+"?width=100%25&height=100%25&lang=ru&new_html5=1" or None
        else:
            return None
            
    def startTime(self):
        if self.matchTimeMsk is not None:
            return datetime.strptime(self.matchTimeMsk, "%Y-%m-%d %H:%M:%S").strftime("%H:%M %d.%m")
        else:
            return None

def downloadGames():
    games = []
    url = "https://api.vtb-league.com/a49755699622d8fe2d87e6d2ac24a7bb/v1/competitions/games"
    payload = {"limit": 500}
    response = requests.get(url, params=payload)
    response_json = response.json()

    for game in response_json["data"]:
        games.append(Game(**game))
    return games

def getFinishedGames(games):
    return list(filter(lambda game: game.matchStatus == "COMPLETE", games))

def getGames(startDate, endDate, games):
    return list(filter(lambda game:
        startDate <= datetime.strptime(game.matchTimeMsk, "%Y-%m-%d %H:%M:%S").date() <= endDate,
    games))
