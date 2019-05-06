// Settings
const srcDB = new Mongo("mongodb://localhost:27017/?replSet=rs0");
const dstDB = new Mongo("mongodb://localhost:27020/?replSet=dest-rs");

// Functions
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

// Status
const status = {
  "different": 0,
  "missing": 0,
  "extraneous": 0
};

function logJSONEvent(databaseName, collectionName, error, documents) {
  const event = {
    database: databaseName,
    collection: collectionName,
    kind: "error",
    errorKind: error
  };
  switch (error) {
    case "different":
      event["sourceDocument"] = documents[0];
      event["destinationDocument"] = documents[1];
      break;
    case "missing":
      event["document"] = documents[0];
      break;
    case "extraneous":
      event["document"] = documents[0];
      break;
  }
  // Print
  printjson(event);
  // Update stats
  status[error]++;
}

// Session handling
const srcDBSession = openSession(srcDB);
const dstDBSession = openSession(dstDB);

// Diff the two databases
srcDBSession.getDatabase("admin")
  .runCommand({ listDatabases: 1 }).databases
  .map(database => database.name)
  .filter(dbName => !["admin", "config", "local"].includes(dbName))
  .forEach(dbName => {
    // Get the databases
    const srcDatabase = srcDBSession.getDatabase(dbName);
    const dstDatabase = dstDBSession.getDatabase(dbName);
    // Compare each collection hash
    const srcHashes = srcDatabase.runCommand({ dbHash: 1 });
    const dstHashes = dstDatabase.runCommand({ dbHash: 1 });
    for (var collection in srcHashes.collections) {
      // Skip processing if hash matches
      if (srcHashes.collections[collection] === dstHashes.collections[collection]) {
        continue;
      }
      // Hash mismatch
      const srcCollection = srcDatabase.getCollection(collection);
      const dstCollection = dstDatabase.getCollection(collection);

      // Print different data
      srcCollection.find().forEach(doc => {
        const dstDocument = dstCollection.findOne({ _id: { $eq: doc._id } });
        if (dstDocument === null) {
          logJSONEvent(dbName, collection, "missing", [doc]);
        } else if (JSON.stringify(doc) !== JSON.stringify(dstDocument)) {
          logJSONEvent(dbName, collection, "different", [doc, dstDocument]);
        }
      });

      // Print extraneous data
      dstCollection.find().forEach(doc => {
        const srcDocument = srcCollection.findOne({ _id: { $eq: doc._id } });
        if (srcDocument === null) {
          logJSONEvent(dbName, collection, "extraneous", [doc]);
        }
      });
    }
  })

// Close the sessions
closeSessions([srcDBSession, dstDBSession]);

// Print statistics
printjson({ kind: "recap", stats: status });