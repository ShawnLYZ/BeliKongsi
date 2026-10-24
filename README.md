# BeliKongsi

**Beli sama-sama, harga borong — Buy together, pay wholesale.**

BeliKongsi is an AI-powered group-buying platform that helps small Malaysian businesses, such as kopitiams, hawker stalls, and cafés, combine their purchases to unlock wholesale prices and save money on everyday supplies.

## Team Information

| Field             | Details                                 |
| ----------------- | --------------------------------------- |
| Team Name         | Steady Bom Bi Bi                        |
| Team Domain       | Domain 2                                |
| SDG Track         | SDG 8 — Decent Work and Economic Growth |
| Team Leader       | Shawn Lee Yan Zheng                     |
| University        | Asia Pacific University (APU)           |
| Number of Members | 3                                       |

## Links

| Resource          | Link                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| GitHub Repository | [BeliKongsi](https://github.com/ShawnLYZ/BeliKongsi.git)                                                 |
| Live Demo         | [BeliKongsi Live Demo](https://beli-kongsi.replit.app)                                                   |
| Slide Deck        | [View Slide Deck](https://drive.google.com/file/d/12vknOh1XJvXkkogn5wjjw7pohjy25dmr/view?usp=drive_link) |
| Demo Video        | [Watch Demo Video](https://youtu.be/lFnS9slgMgI)                                                         |

## Overview

### Problem

Small businesses such as kopitiams, hawker stalls, and cafés regularly purchase supplies in small quantities. As a result, they often miss out on wholesale discounts that larger businesses can access. Although businesses could combine their orders to reduce costs, coordinating quantities, payments, deliveries, and refunds manually is time-consuming and error-prone.

### Solution

BeliKongsi simplifies group purchasing by allowing small businesses to combine their orders through a shared buying platform called a **Kongsi**. AI helps transform unstructured WhatsApp orders and invoice information into organised shopping lists for users to review and confirm.

The platform calculates applicable price tiers, distributes costs, manages simulated payments and refunds, and tracks deliveries. This helps small businesses access better prices while keeping their purchasing information private from other participating shops.

### Key Features

- **AI-Powered Order Processing** — Converts pasted WhatsApp orders and invoice photos into structured shopping lists for user confirmation.
- **Group Buying and Wholesale Pricing** — Combines orders from multiple businesses to unlock volume-based discounts.
- **Automated Basket Management** — Creates recurring weekly shopping baskets from saved shopping lists.
- **Transparent Pricing and Refunds** — Calculates final prices and displays refunds and verified savings.
- **Order and Delivery Tracking** — Supports supplier order approvals, delivery checks, collection, and claims.
- **Privacy and Auditability** — Keeps participating shops anonymous to one another and maintains a tamper-evident activity log.

**Demo disclaimer:** The project uses fictional data. Payments, payouts, logistics, sign-in, and WhatsApp interactions are simulated. No real money moves and no real messages are sent.

## Tech Stack

| Layer                           | Technology                     |
| ------------------------------- | ------------------------------ |
| Frontend                        | Next.js, React, TypeScript     |
| Backend                         | Next.js API Routes, TypeScript |
| Database                        | PostgreSQL                     |
| ORM                             | Prisma                         |
| Production Database and Storage | Supabase                       |
| AI                              | Google Gemini                  |
| Hosting and Development         | Replit                         |
| Testing                         | Vitest, Playwright             |
| Package Manager                 | pnpm                           |

## Project Structure

```text
BeliKongsi/
├── docs/                     # Project documentation
├── prisma/                   # Database schema and migrations
├── scripts/                  # Development and deployment scripts
├── src/
│   ├── app/                  # Pages and API routes
│   │   └── api/              # Backend API endpoints
│   └── server/
│       ├── engine/           # Pricing and settlement rules
│       ├── modules/          # Application business logic
│       ├── adapters/         # AI, storage and service adapters
│       └── platform/         # Permissions and security
├── tests/                    # Automated tests
├── .env.example              # Example environment variables
├── .gitignore
├── package.json
├── pnpm-lock.yaml
├── prisma.config.ts
└── README.md
```

The structure above is a high-level overview. Refer to the repository for the exact file and directory structure.

## Architecture

```text
User
  |
  v
Next.js Application
  |
  +--> Frontend Pages
  |
  +--> API Routes
         |
         v
   Application Services
         |
         +--> Kongsi Engine
         |     - Wholesale pricing
         |     - Cost calculations
         |     - Refunds and settlement
         |
         +--> AI Adapter (Google Gemini)
         |
         +--> Payment and Logistics Adapters
         |     (Simulated in demo mode)
         |
         v
   Prisma + PostgreSQL
         |
         v
   Supabase (Production Database / Storage)
```

## How to Run

### Prerequisites

- Node.js 24
- pnpm 10

### Option 1 — Run on Replit (Recommended)

1. Open the [BeliKongsi Live Demo](https://beli-kongsi.replit.app).
2. Alternatively, import the [GitHub repository](https://github.com/ShawnLYZ/BeliKongsi.git) into Replit.
3. Configure the required environment variables according to `.env.example` and the project's setup instructions.
4. Start the application using the configured run command.

### Option 2 — Run Locally

1. Clone the repository:

   ```bash
   git clone https://github.com/ShawnLYZ/BeliKongsi.git
   cd BeliKongsi
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create your local environment file:

   ```bash
   cp .env.example .env.local
   ```

4. Configure the required environment variables. Generate secure values for `SESSION_SECRET` and `CRON_SECRET` according to the project's instructions.

5. Start the local PostgreSQL database:

   ```bash
   pnpm db:dev
   ```

6. Initialise the database and load demo data:

   ```bash
   pnpm db:reset
   ```

7. Start the development server:

   ```bash
   pnpm dev
   ```

8. Open [http://localhost:3000](http://localhost:3000).

Refer to `.env.example` and the project's deployment documentation for the complete configuration. Never commit API keys, passwords, or other secrets.

## How We Use Replit

Replit is used as a development and hosting environment for BeliKongsi.

- **Development:** Our team uses Replit to develop, configure, run, and test the application.
- **Hosting:** The application is deployed for demonstration at [beli-kongsi.replit.app](https://beli-kongsi.replit.app).
- **Configuration:** Environment variables and secrets are managed through the appropriate environment configuration rather than hardcoded into the source code.
- **Testing and Demonstration:** Replit allows the team to run the application and demonstrate the main user journey.

**Proof of Use:** Include the required Replit proof-of-use document in the submission folder if required by the competition.

## Challenges & Learnings

- **Handling Unstructured Data:** Converting informal WhatsApp orders and invoice information into structured shopping lists requires careful AI processing and user confirmation.
- **Accurate Pricing Calculations:** Group purchasing involves multiple price tiers, shipping costs, fees, and refunds. A dedicated pricing engine helps keep calculations consistent.
- **Managing Complex Workflows:** Coordinating owners, staff, suppliers, and operations requires clear approval steps, order tracking, and delivery verification.
- **Building Trust and Transparency:** Clear price breakdowns, refund records, and activity logs help users understand purchasing decisions and transaction outcomes.

Through this project, we learned how AI and automation can simplify real-world business processes while maintaining human oversight, transparent decision-making, and reliable calculations.

## Future Improvements

1. **Real Payment and Logistics Integration** — Integrate actual payment providers and delivery partners to support real transactions and fulfilment.
2. **Enhanced AI Accuracy** — Improve the recognition of product names, quantities, and pricing information from different order formats and invoice images.
3. **Business Analytics** — Provide deeper insights into purchasing patterns, cost savings, supplier reliability, and ordering efficiency.
4. **Wider Supplier Network** — Expand supplier participation and product coverage to help more small businesses benefit from collective purchasing.

## Team

| Name                | Role        | GitHub                                                     |
| ------------------- | ----------- | ---------------------------------------------------------- |
| Shawn Lee Yan Zheng | Team Leader | [@ShawnLYZ](https://github.com/ShawnLYZ)                   |
| Lee Earn Hui        | Documenter  | [@LEH268](https://github.com/LEH268)                       |
| Lee Min Ming        | Documenter  | [@mmlee1604-creator](https://github.com/mmlee1604-creator) |

## Submission Checklist

- [x] Team name provided
- [x] Team domain set to Domain 2
- [x] SDG track set to SDG 8
- [x] GitHub repository link added
- [x] Live demo link added
- [x] Slide deck link added
- [x] Demo video link added
- [x] Team member information added
- [x] Replit development and hosting information included
- [x] Add Replit proof of use if required
- [x] Confirm all required submission documents are included
- [x] Verify the setup instructions against the current repository
- [x] Ensure no API keys or secrets are committed

## License

This project is licensed under the Apache License 2.0. See the `LICENSE` file for details.
