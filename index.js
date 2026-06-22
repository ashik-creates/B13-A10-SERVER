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
    const bookingCollection = db.collection("bookings");
    const userCollection = db.collection("user");

    app.get("/api/tickets", async (req, res) => {
      const { from, to, transport, sort, page } = req.query;
      console.log(req.query);

      const query = { status: "approved" };

      if (from) query.from = { $regex: from.trim(), $options: "i" };
      if (to) query.to = { $regex: to.trim(), $options: "i" };
      if (transport) query.transportType = transport.trim();

      const sortObj =
        sort === "asc" ? { price: 1 } : sort === "desc" ? { price: -1 } : {};

      const total = await ticketCollection.countDocuments(query);

      const perPage = 6;
      const currentPage = parseInt(page) || 1;
      const skipItems = (currentPage - 1) * perPage;

      const tickets = await ticketCollection
        .find(query)
        .sort(sortObj)
        .skip(skipItems)
        .limit(perPage)
        .toArray();

      res.json({ total, tickets });
    });

    app.get("/api/admin/tickets/all", async (req, res) => {
      const query = { status: "approved" };
      const result = await ticketCollection.find(query).toArray();
      res.json(result);
    });

    app.post("/api/user/bookings", async (req, res) => {
      const booking = req.body;

      const result = await bookingCollection.insertOne(booking);

      await ticketCollection.updateOne(
        { _id: new ObjectId(booking.ticketId) },
        { $inc: { quantity: -Number(booking.quantity) } },
      );

      res.json(result);
    });

    app.get("/api/vendor/bookings/:vendorId", async (req, res) => {
      const vendorId = req.params.vendorId;
      const result = await bookingCollection
        .find({ vendorId: vendorId })
        .toArray();
      res.json(result);
    });

    app.patch("/api/vendor/bookings/:id/status", async (req, res) => {
      const bookingId = req.params.id;

      const { status } = req.body;

      const result = await bookingCollection.updateOne(
        { _id: new ObjectId(bookingId) },
        {
          $set: {
            status: status,
          },
        },
      );

      res.json(result);
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

    app.patch("/api/vendor/tickets/:id/update", async (req, res) => {
      const ticketId = req.params.id;
      const ticketData = req.body;

      const ticket = await ticketCollection.findOne({
        _id: new ObjectId(ticketId),
      });

      if (ticket.status === "rejected") {
        return res
          .status(400)
          .json({ message: "Cannot update a rejected ticket" });
      }

      const result = await ticketCollection.updateOne(
        { _id: new ObjectId(ticketId) },
        {
          $set: {
            ...ticketData,
          },
        },
      );

      res.json(result);
    });

    app.delete("/api/vendor/tickets/:id/delete", async (req, res) => {
      const ticketId = req.params.id;

      const ticket = await ticketCollection.findOne({
        _id: new ObjectId(ticketId),
      });

      if (ticket.status === "rejected") {
        return res
          .status(400)
          .json({ message: "Cannot delete a rejected ticket" });
      }

      const result = await ticketCollection.deleteOne({
        _id: new ObjectId(ticketId),
      });

      res.json(result);
    });

    app.get("/api/user/bookings/:userId", async (req, res) => {
      const userId = req.params.userId;
      const result = await bookingCollection.find({ userId: userId }).toArray();
      res.json(result);
    });

    app.get("/api/admin/tickets", async (req, res) => {
      const tickets = await ticketCollection.find().toArray();
      res.json(tickets);
    });

    app.patch("/api/admin/tickets/:id/status", async (req, res) => {
      const ticketId = req.params.id;
      const { status } = req.body;

      const result = await ticketCollection.updateOne(
        { _id: new ObjectId(ticketId) },
        {
          $set: {
            status: status,
          },
        },
      );

      res.json(result);
    });

    app.get("/api/admin/users", async (req, res) => {
      const users = await userCollection.find().toArray();
      res.json(users);
    });

    app.patch("/api/admin/users/:id/role", async (req, res) => {
      const userId = req.params.id;
      const { role } = req.body;

      const result = await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: {
            role: role,
          },
        },
      );

      res.json(result);
    });

    app.patch("/api/admin/users/:id/fraud", async (req, res) => {
      const userId = req.params.id;
      const { isFraud } = req.body;

      const user = await userCollection.findOne({
        _id: new ObjectId(userId),
      });

      if (user.role !== "vendor") {
        return res
          .status(400)
          .json({ message: "Only vendors can be marked as fraud" });
      }

      const result = await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        {
          $set: {
            isFraud: isFraud,
          },
        },
      );

      await ticketCollection.updateMany(
        { vendorId: userId },
        {
          $set: {
            status: "rejected",
          },
        },
      );

      res.json(result);
    });

    app.patch("/api/admin/tickets/:id/advertise", async (req, res) => {
      const ticketId = req.params.id;
      const { isAdvertised } = req.body;

      const advertisedTicketCount = await ticketCollection.countDocuments({
        isAdvertised: true,
      });

      if (isAdvertised === true) {
        const count = await ticketCollection.countDocuments({
          isAdvertised: true,
        });

        if (count >= 6) {
          return res.status(400).json({
            message: "Maximum number of advertised tickets reached",
          });
        }
      }

      const result = await ticketCollection.updateOne(
        { _id: new ObjectId(ticketId) },
        {
          $set: {
            isAdvertised: isAdvertised,
          },
        },
      );

      res.json(result);
    });

    app.get("/api/tickets/advertised/all", async (req, res) => {
      const tickets = await ticketCollection
        .find({ isAdvertised: true })
        .toArray();
      res.json(tickets);
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
