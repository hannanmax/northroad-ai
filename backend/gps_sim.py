SUDBURY_ROUTE = [
    (46.4917, -80.9930),
    (46.4891, -80.9912),
    (46.4865, -80.9895),
    (46.4840, -80.9878),
    (46.4815, -80.9862),
    (46.4789, -80.9847),
    (46.4762, -80.9831),
    (46.4735, -80.9815),
]


def interpolate_gps(frame_num: int, total_frames: int) -> tuple[float, float]:
    if total_frames <= 0:
        return SUDBURY_ROUTE[0]
    t = frame_num / total_frames
    scaled = t * (len(SUDBURY_ROUTE) - 1)
    i = int(scaled)
    frac = scaled - i
    if i >= len(SUDBURY_ROUTE) - 1:
        return SUDBURY_ROUTE[-1]
    lat = SUDBURY_ROUTE[i][0] + frac * (SUDBURY_ROUTE[i + 1][0] - SUDBURY_ROUTE[i][0])
    lng = SUDBURY_ROUTE[i][1] + frac * (SUDBURY_ROUTE[i + 1][1] - SUDBURY_ROUTE[i][1])
    return lat, lng
