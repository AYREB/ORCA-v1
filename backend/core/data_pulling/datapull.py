import yfinance as yf
import pandas as pd
import pandas_ta as ta
import os

def get_data_with_indicator(
    ticker: str,
    start: str,
    end: str,
    interval: str = "1h",
    dropna: bool = True,
    save_path: str = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data_csvs")
) -> pd.DataFrame:
    """
    Download historical OHLC (Open, High, Low, Close) data for a given ticker using Yahoo Finance.

    Parameters:
    -----------
    ticker : str
        The stock symbol to download data for (e.g., "AAPL").
    start : str
        Start date in "YYYY-MM-DD" format.
    end : str
        End date in "YYYY-MM-DD" format.
    interval : str, optional, default "1h"
        Data interval. Options: "1m", "2m", "5m", "15m", "30m", "60m", "90m", "1d", "5d", "1wk", "1mo", "3mo".
    dropna : bool, optional, default True
        Whether to drop rows with missing values.
    save_path : str or None, optional, default None
        Path to save the downloaded data as CSV. If None, the data is not saved.

    Returns:
    --------
    pd.DataFrame
        A DataFrame containing the OHLC data along with Volume and Adj Close if available.

    Example:
    --------
    data = get_data_with_indicator(
        \n  ticker="AAPL",
        \n  start="2024-01-01",
        \n  end="2025-01-01",
        \n  interval="1h"
        \n  save_path="Core/DataPulling/AAPL_data.csv"
    )
    """

    # 1. Download data
    data = yf.download(ticker, start=start, end=end, interval=interval, group_by="column")

    # 2. Flatten columns if multi-index
    if isinstance(data.columns, pd.MultiIndex):
        data.columns = [col[0] if isinstance(col, tuple) else col for col in data.columns]

    # 3. Drop NaN rows (optional)
    if dropna:
        data = data.dropna()

    # 4. Save to CSV if requested
    if save_path:
        actualSavePath = f"{save_path}/{ticker}.csv"
        data.to_csv(actualSavePath, index=True)
        print(f"✅ Data saved to: {actualSavePath}")

    return data


# # # Example usage:
# data = get_data_with_indicator(
#     ticker="AAPL",
#     start="2024-01-01",
#     end="2025-01-01",
#     interval="1h",
#     #save_path="Core/DataPulling/AAPL_data.csv"
# )

