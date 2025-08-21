import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "1mb" }));

function wrapText(text, lineLength = 32) {
  const words = (text || "").split(" ");
  let lines = [], currentLine = "";
  for (let word of words) {
    if ((currentLine + word).length <= lineLength) currentLine += word + " ";
    else { lines.push(currentLine.trim()); currentLine = word + " "; }
  }
  if (currentLine) lines.push(currentLine.trim());
  return lines.join("\n");
}

function wrapItemLine(text, price, maxLineLength = 42) {
  const words = (text || "").split(" ");
  const lines = [];
  let line = "";
  for (let word of words) {
    if ((line + word).length + 1 <= maxLineLength) line += word + " ";
    else { lines.push(line.trim()); line = word + " "; }
  }
  if (line) lines.push(line.trim());
  const lastLine = lines.pop() || "";
  const pricedLine = lastLine.padEnd(maxLineLength - price.length) + price;
  lines.push(pricedLine);
  return lines.join("\n");
}

// EXACT MC_Print3 formatting
function buildEscpos(orderSummary, meta) {
  const {
    restaurant_name = "Chesters Takeaway",
    restaurant_address = "153-155 Blackburn Road, Bolton, BL1 8HE",
    order_id = "ORDER-NA",
    payment_status = "Not Paid",
  } = meta || {};

  const labelValueLine = (label, value) => `${label.padEnd(13)}${value}`;

  const formattedItems = (orderSummary.order_breakdown || [])
    .map((item) => {
      const qty = item.quantity ? `${item.quantity} x ` : "1 x ";
      const nameNote = `${qty}${item.name}${item.notes ? ` (${item.notes})` : ""}`;
      const price = `#${parseFloat(item.price || 0).toFixed(2)}`;
      return wrapItemLine(nameNote, price);
    })
    .join("\n");

  const isCollect = (orderSummary.delivery_type || "").toLowerCase() === "collect";
  const deliveryInfo = !isCollect
    ? [
        labelValueLine("To:", orderSummary.delivery_address || ""),
        labelValueLine("Postcode:", orderSummary.postcode || ""),
      ].join("\n") + "\n"
    : "";

  const deliveryChargeLine = !isCollect ? "Delivery Charge: #1.50\n" : "";
  const total =
    parseFloat(orderSummary.total_amount || 0) + (isCollect ? 0 : 1.5);
  const totalLine = `\nTotal:         #${total.toFixed(2)}\n`;

  let data = "";
  data += "\x1b\x1d\x61\x01";          // Center align
  data += "\x1b\x69\x01\x00";
  data += "\x1b\x45";                  // Bold on
  data += `${restaurant_name.toUpperCase()}\n`;
  data += "\x1b\x69\x00\x00";          // Reset font
  data += `${restaurant_address}\n`;
  data += "\x1b\x46";                  // Bold off
  data += "\x1b\x1d\x21\x00";          // Normal font
  data += "------------------------------------\n";

  data += `Order Time: ${new Date(orderSummary.createdAt || Date.now()).toLocaleString()}\n`;
  data += `Order ID: ${order_id}\n`;
  data += "------------------------------------\n";
  data += "\x1b\x45";
  data += `Extra Notes:\n${wrapText(orderSummary.special_notes || "None")}\n`;
  data += "\x1b\x46";
  data += "------------------------------------\n";

  data += labelValueLine("Type:", orderSummary.delivery_type || "Collect") + "\n";
  data += deliveryInfo;
  data += labelValueLine("Customer:", orderSummary.customer_name || "") + "\n";
  data += labelValueLine("Contact:", orderSummary.contact || "") + "\n\n";

  data += "******************* ITEMS ******************\n";
  data += "\x1b\x45";
  data += "Description                   Amount\n";
  data += "\x1b\x46";
  data += `${formattedItems}\n`;
  data += "-------------------------------------\n";
  data += `SubTotal:     #${parseFloat(orderSummary.total_amount || 0).toFixed(2)}\n`;
  data += deliveryChargeLine;
  data += "\x1b\x45";                  // Bold
  data += "---------------------\n";
  data += totalLine;
  data += "---------------------\n";
  data += "\x1b\x46";                  // Bold off

  data += "\x1b\x45";                  // Bold
  data += "\x1b\x69\x01\x00";
  data += `PAYMENT: ${String(payment_status || "").toUpperCase()}\n`;
  data += "\x1b\x69\x00\x00";
  data += "\x1b\x46";                  // Bold off

  data += "\n\n\n";
  data += "\x1b\x64\x02";              // Feed 2
  data += "\x1b\x69";                  // Cut
  return data;
}

app.post("/print", async (req, res) => {
  try {
    const {
      printerMAC, orderSummary, order_id,
      restaurant_name, restaurant_address, payment_status
    } = req.body || {};
    if (!printerMAC || !orderSummary) {
      return res.status(400).json({ ok: false, error: "Missing printerMAC or orderSummary" });
    }
    const data = buildEscpos(orderSummary, {
      order_id, restaurant_name, restaurant_address, payment_status
    });
    const payload = { printerMAC, data };
    const r = await axios.post("https://cloudprinter.onrender.com/orders", payload);
    return res.json({ ok: true, cloudprinter: r.data });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Printer service listening on", PORT));
