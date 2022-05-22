
# Common Eventing funtions

## StateManager

Arguments
 - Event Store Connection - a connection to a mongo collection to store an immutable series of events
 - State Store Connection - a local DB for storing materialised state built & reconstructed from events
 - Reducers - a array of functions that convert Actions into "State Change Events"

Functions 
 - dispatch(Actions) 
   1. Takes a "action", executes reduces to get "State Change Events"
   2. Pushes the "State Change Events" onto the Event Store
   3. Updates the local State Store

