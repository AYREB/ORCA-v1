def extract_tickers(parsed_dsl):
   tickers = set()
   for cmd_data in parsed_dsl.values():
       if not isinstance(cmd_data, dict):
           continue  # skip top-level string/list keys
       context = cmd_data.get("context", {})
       tickers.update(context.get("tickers", []))
   return list(tickers)




def extract_data_timeframes(parsed_dsl):
   """
   Extracts all unique data timeframe values from the parsed DSL output.
   """
   # First, check if the DSL explicitly defines DATA_TIMEFRAMES
   if "DATA_TIMEFRAMES" in parsed_dsl:
       tfs = parsed_dsl["DATA_TIMEFRAMES"]
       if isinstance(tfs, str):
           tfs = [tf.strip() for tf in tfs.split(",")]
       elif isinstance(tfs, list):
           tfs = list(tfs)
       return tfs
   timeframes = set()
   for cmd_data in parsed_dsl.values():
       if not isinstance(cmd_data, dict):
           continue  # skip top-level string/list
       context = cmd_data.get("context", {})
       for tf in context.get("data_timeframes", []):
           timeframes.add(tf)
   return list(timeframes)



def extract_execution_timeframe(parsed_dsl):
    """
    Returns the execution timeframe string from the DSL.
    """

    # Find the root trade block (LONG or SHORT)
    trade_block = parsed_dsl.get("LONG") or parsed_dsl.get("SHORT")
    if not trade_block:
        print("No LONG or SHORT block found in DSL")
        return "1h"

    context = trade_block.get("context", {})

    if "execution_timeframe" in context:
        print(f"Execution timeframe is {context['execution_timeframe']}")
        return context["execution_timeframe"]

    print("No execution_timeframe found in context, defaulting to 1h")
    return "1h"






def extract_dateframe(parsed_dsl):
   """
   Extracts the global DATEFRAME (start/end dates) from the parsed DSL.
   Returns a dict: {'start': ..., 'end': ...} or None if missing.
   """
   # First, check the top-level DATA_TIMEFRAMES / EXECUTION_TIMEFRAME entries if any contain context
   for block_name, block_content in parsed_dsl.items():
       if isinstance(block_content, dict):  # safe check
           context = block_content.get("context", {})
           if "dateframe" in context:
               return context["dateframe"]


   # Then check top-level DATEFRAME key if it exists
   if "DATEFRAME" in parsed_dsl:
       df = parsed_dsl["DATEFRAME"]
       if isinstance(df, dict):
           return df
       elif isinstance(df, list) and len(df) == 2: 
           return {"start": df[0], "end": df[1]}


   return None




    # def search_conditions(cond):
    #     if isinstance(cond, dict):
    #         # Look for any function with a string as first argument
    #         for side in ["left", "right"]:
    #             op = cond.get(side)
    #             if isinstance(op, dict) and "func" in op:
    #                 arg = op.get("arg")
    #                 # if arg is a list (like SMA('AAPL', 20)), take first
    #                 if isinstance(arg, list) and arg:
    #                     tickers.add(arg[0])
    #                 elif isinstance(arg, str):
    #                     tickers.add(arg)
    #         # Recurse into AND/OR groups
    #         if "AND" in cond:
    #             for sub in cond["AND"]:
    #                 search_conditions(sub)
    #         if "OR" in cond:
    #             for sub in cond["OR"]:
    #                 search_conditions(sub)

    # for cmd_blocks in parsed_dsl.values():
    #     for block in cmd_blocks.values():
    #         if isinstance(block, dict) and "CONDITIONS" in block:
    #             search_conditions(block["CONDITIONS"])

    # return list(tickers)
