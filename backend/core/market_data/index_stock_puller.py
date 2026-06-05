import os
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import AssetClass, AssetStatus
import pandas as pd
from dotenv import load_dotenv
import requests 
load_dotenv()

API_KEY = "PK4LAVX3E3GEDRKDQUT725VRHT"
API_SECRET = "Bxxw8gVAJzwufE8Ss2NwDA63Ksm5u6PajrKUk6cLaxoy"

ALPACA_BASE_URL = "https://paper-api.alpaca.markets"

# ------------------------
# Fetch all assets from Alpaca
def get_all_assets():
    url = f"{ALPACA_BASE_URL}/v2/assets"
    headers = {
        "APCA-API-KEY-ID": API_KEY,
        "APCA-API-SECRET-KEY": API_SECRET
    }

    all_assets = []
    page = 1

    while True:
        response = requests.get(url, headers=headers, params={"page": page, "per_page": 100})
        response.raise_for_status()
        data = response.json()
        if not data:
            break
        all_assets.extend(data)
        page += 1

    return all_assets

# ------------------------
# Filter for NASDAQ equities
def get_nasdaq_equities():
    all_assets = get_all_assets()
    nasdaq_assets = [
        asset for asset in all_assets
        if asset.get("exchange") == "NASDAQ"
        and asset.get("status") == "active"
        and asset.get("tradable") is True
        and asset.get("class") == "us_equity"
    ]
    return nasdaq_assets

# ------------------------
# Save to CSV
def save_to_csv(assets, filename="nasdaq_universe.csv"):
    if not assets:
        print("No assets to save.")
        return

    keys = ["symbol", "name", "exchange", "status", "class", "tradable"]
    with open(filename, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        for asset in assets:
            writer.writerow({k: asset.get(k, "") for k in keys})

    print(f"Saved {len(assets)} NASDAQ equities to {filename}")

# ------------------------
# Main
if __name__ == "__main__":
    nasdaq_universe = get_nasdaq_equities()
    save_to_csv(nasdaq_universe)