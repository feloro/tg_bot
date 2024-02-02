from pydantic import BaseModel
from typing import Optional

class TriggerPayload(BaseModel):
    triggerMethodName: str
    matchId: Optional[int]