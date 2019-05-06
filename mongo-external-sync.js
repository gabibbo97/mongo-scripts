// Settings
const srcDB = new Mongo("mongodb://localhost:27017/?replSet=rs0");
const dstDB = new Mongo("mongodb://localhost:27020/?replSet=dest-rs");
const DEBUG = true;

// Functions
function printDebug(msg) {
  if (DEBUG) {
    print(msg);
  }
}

function openSession(mongo) {
  // Opens a session to the given mongo
  const sessionSettings = {
    readConcern: {
      level: "majority"
    },
    readPreference: {
      mode: "secondaryPreferred"
    },
    retryWrites: true,
    writeConcern: {
      w: "majority",
      j: true
    }
  };
  return mongo.startSession(sessionSettings);
}

function closeSessions(sessions) {
  // Close the provided sessions
  sessions.forEach(session => session.endSession());
}

// Session handling
const srcDBSession = openSession(srcDB);
const dstDBSession = openSession(dstDB);

// Watch for changes
function getDatabaseFromChangeDocument(changeDocument, session) {
  // Gets the database handle from the session for the affected database
  return session.getDatabase(changeDocument.ns.db);
}
function getCollectionFromChangeDocument(changeDocument, session) {
  // Gets the collection handle from the session for the affected database
  return getDatabaseFromChangeDocument(changeDocument, session)
    .getCollection(changeDocument.ns.coll);
}

function handleDelete(changeDocument, srcSession, dstSession) {
  // Handles a delete operation
  getCollectionFromChangeDocument(changeDocument, dstSession)
    .deleteOne({ _id: { $eq: changeDocument.documentKey._id } });
}
function handleDrop(changeDocument, srcSession, dstSession) {
  // Handles a drop operation
  getCollectionFromChangeDocument(changeDocument, dstSession)
    .drop();
}
function handleDropDatabase(changeDocument, srcSession, dstSession) {
  // Handles a drop database operation
  getDatabaseFromChangeDocument(changeDocument, dstSession)
    .dropDatabase();
}
function handleInsert(changeDocument, srcSession, dstSession) {
  // Handles an insert operation
  getCollectionFromChangeDocument(changeDocument, dstSession)
    .insertOne(changeDocument.fullDocument);
}
function handleInvalidate(changeDocument, srcSession, dstSession) {
  // Handles an invalidate operation
  // TODO
}
function handleRename(changeDocument, srcSession, dstSession) {
  // Handles a rename operation
  getCollectionFromChangeDocument(changeDocument, dstSession)
    .renameCollection(changeDocument.to.coll);
}
function handleReplace(changeDocument, srcSession, dstSession) {
  // Handles a replace operation
  getCollectionFromChangeDocument(changeDocument, dstSession)
    .replaceOne({ _id: { $eq: changeDocument.documentKey._id } }, changeDocument.fullDocument);
}
function handleUpdate(changeDocument, srcSession, dstSession) {
  // Handles an update operation
  handleReplace(changeDocument, srcSession, dstSession);
}
const statCounter = {};
function handleChange(changeDocument, srcSession, dstSession) {
  // Mimicks changes from srcSession to dstSession
  // Register handlers
  const actionHandlers = {
    "delete": [handleDelete],
    "drop": [handleDrop],
    "dropDatabase": [handleDropDatabase],
    "insert": [handleInsert],
    "invalidate": [handleInvalidate],
    "rename": [handleRename],
    "replace": [handleReplace],
    "update": [handleUpdate]
  };
  // Act depending on change type
  if (actionHandlers[changeDocument.operationType]) {
    // Call the handlers
    actionHandlers[changeDocument.operationType].forEach(fn => fn(changeDocument, srcSession, dstSession));
  } else {
    // Unknown operation
    print(`Unhandled operation ${changeDocument.operationType}`);
  }

  // Record statistics
  if (!statCounter[changeDocument.operationType]) {
    statCounter[changeDocument.operationType] = 1;
  } else {
    statCounter[changeDocument.operationType]++;
  }
  printDebug(`${changeDocument.operationType} number ${statCounter[changeDocument.operationType]}`);
}
function watchForChanges(mongo, srcSession, dstSession) {
  // Watch for changes on the given mongo, syncing data from src to dst
  let lastChangeID = null;
  // Open the change stream
  const changeStreamCursor = mongo.watch([], { fullDocument: "updateLookup" });
  // Handle the change stream
  while (!changeStreamCursor.isExhausted()) {
    if (changeStreamCursor.hasNext()) {
      // Perform these actions if the cursor has data
      const changeDocument = changeStreamCursor.next();
      lastChangeID = changeDocument._id;
      handleChange(changeDocument, srcSession, dstSession);
    }
  }
  // Print the last synced id
  if (lastChangeID) {
    print("Last synced id:");
    printjson(lastChangeID)
  }
}
watchForChanges(srcDB, srcDBSession, dstDBSession);

// Close the sessions
closeSessions([srcDBSession, dstDBSession]);