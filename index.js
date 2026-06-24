const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
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

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    console.log(payload);
    req.user = payload;

    next();
  } catch (error) {
    console.log(error);
    return res.status(401).json({ msg: "Unauthorized" });
  }
};

const verifyAdmin = async (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

const verifyUser = async (req, res, next) => {
  if (req.user.role !== "user") {
    return res.status(403).send({ message: "forbidden access" });
  }
  next();
};

const verifyVendor = async (req, res, next) => {
  if (req.user.role !== "vendor") {
    return res.status(403).json({
      message: "forbidden access",
    });
  }

  const vendor = await userCollection.findOne({
    email: req.user.email,
  });

  if (vendor?.isFraud) {
    return res.status(403).json({
      message: "Fraud vendors cannot perform this action",
    });
  }

  next();
};

async function run() {
  try {
    await client.connect();

    const db = client.db("ticket_bari");

    const ticketCollection = db.collection("tickets");
    const bookingCollection = db.collection("bookings");
    const userCollection = db.collection("user");
    const paymentCollection = db.collection("payments");

    const verifyVendor = async (req, res, next) => {
      if (req.user.role !== "vendor") {
        return res.status(403).json({
          message: "forbidden access",
        });
      }

      const vendor = await userCollection.findOne({
        email: req.user.email,
      });

      if (vendor?.isFraud) {
        return res.status(403).json({
          message: "Fraud vendors cannot perform this action",
        });
      }

      next();
    };

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

    app.get(
      "/api/admin/tickets/all",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const query = { status: "approved" };
        const result = await ticketCollection.find(query).toArray();
        res.json(result);
      },
    );

    app.post(
      "/api/user/bookings",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const booking = req.body;

        const result = await bookingCollection.insertOne(booking);

        await ticketCollection.updateOne(
          { _id: new ObjectId(booking.ticketId) },
          { $inc: { quantity: -Number(booking.quantity) } },
        );

        res.json(result);
      },
    );

    app.get(
      "/api/vendor/bookings/:vendorId",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        const vendorId = req.params.vendorId;

        if (vendorId !== req.user.id) {
          return res.status(403).json({
            message: "forbidden access",
          });
        }
        const result = await bookingCollection
          .find({ vendorId: vendorId })
          .toArray();
        res.json(result);
      },
    );

    app.post(
      "/api/save/payments/user",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const { bookingId } = req.body;
        const { sessionId } = req.body;
        const payment = req.body;

        const alreadyExists = await paymentCollection.findOne({
          sessionId: sessionId,
        });

        if (alreadyExists) {
          return res.status(400).json({
            message: "Payment already exists",
          });
        }

        const result = await paymentCollection.insertOne({
          ...payment,
          createdAt: new Date(),
        });

        await bookingCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          {
            $set: {
              status: "paid",
            },
          },
        );

        res.json(result);
      },
    );

    app.patch(
      "/api/vendor/bookings/:id/status",
      verifyToken,
      verifyVendor,
      async (req, res) => {
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
      },
    );

    app.get(
      "/api/transactions/user/:userId",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const userId = req.params.userId;
        const result = await paymentCollection
          .find({ userId: userId })
          .toArray();
        res.json(result);
      },
    );

    app.get(
      "/api/vendor/stats/:vendorId",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        const { vendorId } = req.params;

        const totalTickets = await ticketCollection.countDocuments({
          vendorId,
        });

        const bookings = await bookingCollection.find({ vendorId }).toArray();

        const paidBookings = bookings.filter(
          (booking) => booking.status === "paid",
        );

        const totalSold = paidBookings.reduce(
          (sum, booking) => sum + Number(booking.quantity),
          0,
        );

        const totalRevenue = paidBookings.reduce(
          (sum, booking) => sum + Number(booking.totalPrice),
          0,
        );

        res.json({
          totalTickets,
          totalSold,
          totalRevenue,
        });
      },
    );

    app.get("/api/tickets/:id", verifyToken, async (req, res) => {
      const ticketId = req.params.id;

      const ticket = await ticketCollection.findOne({
        _id: new ObjectId(ticketId),
      });

      res.json(ticket);
    });

    app.get("/api/tickets/home/latest", async (req, res) => {
      const latestTickets = await ticketCollection
        .find({ status: "approved" })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();

      res.json(latestTickets);
    });

    app.get(
      "/api/vendor/tickets/:id",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        const vendorId = req.params.id;
        const result = await ticketCollection
          .find({
            vendorId: vendorId,
          })
          .toArray();
        res.json(result);
      },
    );

    app.patch(
      "/api/vendor/tickets/:id/update",
      verifyToken,
      verifyVendor,
      async (req, res) => {
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
      },
    );

    app.delete(
      "/api/vendor/tickets/:id/delete",
      verifyToken,
      verifyVendor,
      async (req, res) => {
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
      },
    );

    app.get(
      "/api/user/bookings/:userId",
      verifyToken,
      verifyUser,
      async (req, res) => {
        const userId = req.params.userId;
        if (userId !== req.user.id) {
          return res.status(403).json({
            message: "forbidden access",
          });
        }
        const result = await bookingCollection
          .find({ userId: userId })
          .toArray();
        res.json(result);
      },
    );

    app.get(
      "/api/admin/tickets",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const tickets = await ticketCollection.find().toArray();
        res.json(tickets);
      },
    );

    app.patch(
      "/api/admin/tickets/:id/status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
      },
    );

    app.get("/api/admin/users", verifyToken, verifyAdmin, async (req, res) => {
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

    app.patch(
      "/api/admin/users/:id/fraud",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
      },
    );

    app.patch(
      "/api/admin/tickets/:id/advertise",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
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
      },
    );

    app.get("/api/tickets/advertised/all", async (req, res) => {
      const tickets = await ticketCollection
        .find({ isAdvertised: true })
        .toArray();
      res.json(tickets);
    });

    app.post(
      "/api/vendor/tickets",
      verifyToken,
      verifyVendor,
      async (req, res) => {
        const ticket = req.body;
        const ticketObj = {
          ...ticket,
          createdAt: new Date(),
        };
        const result = await ticketCollection.insertOne(ticketObj);
        res.json(result);
      },
    );

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
