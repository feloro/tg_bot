import requests

from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class TeamNameLocale(BaseModel):
    ru: str
    en: str

class Season(BaseModel):
    isCurrent: bool
    season: int

class Competitor(BaseModel):
    isHomeCompetitor: bool
    scoreString: int
    teamName: TeamNameLocale
    teamId: int = -1
    scoreString: int

class Game(BaseModel):
    matchId: int
    matchStatus: str
    matchTimeMSK: str
    _videoUrl: Optional[str] = None
    competitors: Optional[List[Competitor]] = None
            
    def videoUrl(self):
        if self._videoUrl is None :
            self._videoUrl = getVideoURL(self.matchId)
            return self._videoUrl
        else:
            return self._videoUrl 

    def startTime(self):
        if self.matchTimeMSK is not None:
            return datetime.strptime(self.matchTimeMSK, "%Y-%m-%dT%H:%M:%S%z").strftime("%H:%M %d.%m")
        else:
            return None

def downloadGames():
    games = []

    season = getCurrentSeason()
    url = "https://api.vtb-league.com/v2/leagues/vtb/seasons/{}/matches".format(season.season)
    payload = {"limit": 500}
    response = requests.get(url, params=payload)
    response_json = response.json()

    for gameJSON in response_json["data"]:
        game = Game(**gameJSON)
        games.append(game)
    return games

def getVideoURL(matchId):
    matchUrl = "https://api.vtb-league.com/v2/matches/{}/info".format(matchId)
    response = requests.get(matchUrl)
    response_json = response.json()
    try:
        return response_json["data"]["broadcast"]["iframeUrl"]
    except KeyError:
        return None
    

def getCurrentSeason():
    url = "https://api.vtb-league.com/v2/leagues/vtb/seasons"
    payload = {"limit": 100, "fields": "isCurrent,season"}
    response = requests.get(url, params=payload)
    response_json = response.json()

    for seasonJson in response_json["data"]:
        season = Season(**seasonJson)
        if season.isCurrent:
            return season

def getFinishedGames(games):
    return list(filter(lambda game: game.matchStatus == "COMPLETE", games))

def getGames(startDate, endDate, games):
    return list(filter(lambda game:
        startDate <= datetime.strptime(game.matchTimeMSK, "%Y-%m-%dT%H:%M:%S%z").date() <= endDate,
    games))
    

