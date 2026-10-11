from time import time

from . import models as dr
from .drtv import get_jsonblob


class LiveChannel:
    def __init__(self, title, stream_url):
        self.title = title
        self.stream_url = stream_url


live_channels = None
last_fetch = 0


async def get_channels():
    global live_channels
    global last_fetch
    if last_fetch + 60 * 30 < time() or (len(live_channels) == 0 and last_fetch + 60 < time()):
        blob = await get_jsonblob("https://www.dr.dk/drtv/kanal/dr1_20875")
        page = dr.ChannelPage.model_validate(blob)
        live_channels = {
            c.channel_short_code: LiveChannel(c.title, c.custom_fields.hls_url)
            for c in page.channels()
        }
        last_fetch = time()
    return live_channels
