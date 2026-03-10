# Install dependencies first:
# pip install openai pydantic

from pydantic import BaseModel, Field, ValidationError
from typing import List, Literal, Optional
import json
import os
from openai import OpenAI

# === 1. JSON Schema ===
class Condition(BaseModel):
    left: str
    operator: Literal["<", ">", "=="]
    right: str

class OpenClose(BaseModel):
    conditions: List[Condition] = Field(..., min_items=1)
    stop_loss_percent: Optional[float] = None
    take_profit_percent: Optional[float] = None

class Long(BaseModel):
    open: OpenClose
    close: OpenClose

class Strategy(BaseModel):
    tickers: List[str] = Field(..., min_items=1)
    execution_timeframe: str
    date_range: List[str] = Field(..., min_items=2, max_items=2)
    long: Long

# === 2. User alias memory ===
USER_ALIASES = {
    "tight stop": 1.0,  # percent
    "normal stop": 2.0
}

# === 3. LLM call function ===
def get_strategy_from_llm(user_input: str) -> dict:
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    prompt = f"""
Translate the following user request into JSON matching this schema:

{{"tickers":["string"], "execution_timeframe":"string", "date_range":["YYYY-MM-DD","YYYY-MM-DD"],
"long":{{"open":{{"conditions":[{{"left":"string","operator":">","right":"string"}}],"stop_loss_percent":float,"take_profit_percent":float}},
"close":{{"conditions":[{{"left":"string","operator":">","right":"string"}}]}}}}}}

User request: "{user_input}"

- Flag ambiguous phrases like "tight stop" as numbers using alias mapping if possible.
- Output **valid JSON only**.
"""
    resp = client.chat.completions.create(
        model="gpt-5-mini",
        messages=[{"role": "user", "content": prompt}]
    )
    return json.loads(resp.choices[0].message.content)

# === 4. Convert JSON → DSL ===
def json_to_dsl(strategy: Strategy) -> str:
    dsl = f":TICKER({','.join(strategy.tickers)})\n"
    dsl += f":EXECUTION_TIMEFRAME({strategy.execution_timeframe})\n"
    dsl += f":DATEFRAME({strategy.date_range[0]},{strategy.date_range[1]})\n"
    dsl += ":LONG(\n"
    # Open
    dsl += "  OPEN{\n"
    for c in strategy.long.open.conditions:
        dsl += f"    CONDITIONS{{ {c.left} {c.operator} {c.right} }}\n"
    if strategy.long.open.stop_loss_percent is not None:
        dsl += f"    |ARGUMENTS{{ stopLossPercent = {strategy.long.open.stop_loss_percent} }}\n"
    if strategy.long.open.take_profit_percent is not None:
        dsl += f"    |ARGUMENTS{{ takeProfitPercent = {strategy.long.open.take_profit_percent} }}\n"
    dsl += "  }\n"
    # Close
    dsl += "  |CLOSE{\n"
    for c in strategy.long.close.conditions:
        dsl += f"    CONDITIONS{{ {c.left} {c.operator} {c.right} }}\n"
    dsl += "  }\n"
    dsl += ")"
    return dsl

# === 5. Main function ===
def main():
    user_input = input("Enter strategy in natural language:\n> ")
    
    # Map user aliases manually first
    for alias, value in USER_ALIASES.items():
        if alias in user_input.lower():
            user_input = user_input.lower().replace(alias, str(value))
    
    # LLM → JSON
    try:
        raw_json = get_strategy_from_llm(user_input)
        strategy = Strategy.model_validate(raw_json)
    except ValidationError as e:
        print("Validation failed:", e)
        return
    except Exception as e:
        print("LLM error or invalid JSON:", e)
        return
    
    # Convert → DSL
    dsl = json_to_dsl(strategy)
    print("\n=== Generated DSL ===\n")
    print(dsl)

if __name__ == "__main__":
    main()
