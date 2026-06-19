const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();

    const db = client.db("ticket_bari");

    const ticketCollection = db.collection("tickets");

    app.get("/api/tickets", async (req, res) => {
      const tickets = await ticketCollection
        .find({
          status: "approved",
        })
        .toArray();
      res.json(tickets);
    });

    app.get("/api/tickets/:id", async (req, res) => {
      const ticketId = req.params.id;

      const ticket = await ticketCollection.findOne({
        _id: new ObjectId(ticketId),
      });

      res.json(ticket);
    });

    app.get("/api/vendor/tickets/:id", async (req, res) => {
      const vendorId = req.params.id;
      const result = await ticketCollection
        .find({
          vendorId: vendorId,
        })
        .toArray();
      res.json(result);
    });

    app.post("/api/vendor/tickets", async (req, res) => {
      const ticket = req.body;
      const ticketObj = {
        ...ticket,
        createdAt: new Date(),
      };
      const result = await ticketCollection.insertOne(ticketObj);
      res.json(result);
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("App is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
