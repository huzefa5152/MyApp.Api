# Delivery Challan Management System

![.NET](https://img.shields.io/badge/.NET-9.0-512BD4?logo=dotnet&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![SQL Server](https://img.shields.io/badge/SQL%20Server-2022-CC2927?logo=microsoftsqlserver&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)

A full-stack web application for managing **delivery challans** (delivery receipts/invoices) across multiple companies and clients. Built with ASP.NET Core 9 and React 19, the system streamlines the creation, tracking, and lookup of delivery documents with automatic challan numbering, dynamic line items, and autocomplete-powered data entry.

---

## Features

- **Multi-Company Support** -- Manage multiple business entities, each with independent challan numbering sequences
- **Client Management** -- Full CRUD operations for delivery recipients with search and filtering
- **Delivery Challan Creation** -- Dynamic form with add/remove line items, autocomplete for descriptions and units, and automatic challan number generation per company
- **Lookup Autocomplete** -- Item descriptions and units auto-suggest from existing data; new entries are created on the fly
- **Challan Search & Detail View** -- Browse and inspect delivery challans with full line-item detail
- **Responsive UI** -- Bootstrap 5 card grids, tables, and draggable modals for a polished user experience
- **Dockerized** -- Production-ready Dockerfile included

---

## Screenshots

> _Screenshots coming soon. Add images to a `/docs/screenshots` directory and reference them here._

| Dashboard | Challan Creation | Company Management |
|:---------:|:----------------:|:------------------:|
| _placeholder_ | _placeholder_ | _placeholder_ |

---

## Tech Stack

| Layer | Technology |
|------------|--------------------------------------|
| **Backend** | ASP.NET Core 9, C# 13 |
| **ORM** | Entity Framework Core 9 |
| **Database** | SQL Server |
| **Frontend** | React 19, React Router 7 |
| **UI** | Bootstrap 5 |
| **Bundler** | Vite |
| **Container** | Docker |

---

## Architecture

The application follows an **N-Tier architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                      React Frontend                     │
│          (Vite + React 19 + React Router 7)             │
└────────────────────────┬────────────────────────────────┘
                         │  HTTP / JSON
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    API Controllers                       │
│  CompaniesController  ClientsController  LookupController│
│              DeliveryChallansController                  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Service Layer                          │
│         (Business logic & validation)                    │
│      Services/Interfaces  →  Services/Implementations   │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  Repository Layer                        │
│          (Data access abstraction)                       │
│   Repositories/Interfaces  →  Repositories/Implementations│
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              Entity Framework Core 9                     │
│                   AppDbContext                           │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                     SQL Server                           │
└─────────────────────────────────────────────────────────┘
```

---

## Domain Model

```
Company ──────< DeliveryChallan >────── Client
                     │
                     ├──< DeliveryItem
                     │
               ItemDescription (lookup)
               Unit            (lookup)
```

| Entity | Key Fields |
|---------------------|-----------------------------------------------------|
| **Company** | Name, StartingChallanNumber, CurrentChallanNumber |
| **Client** | Name, Address, Phone, Email |
| **DeliveryChallan** | ChallanNumber (auto-incremented per company), PoNumber, DeliveryDate |
| **DeliveryItem** | Description, Quantity, Unit |
| **ItemDescription** | Description (autocomplete lookup) |
| **Unit** | Name (autocomplete lookup) |

---

## Getting Started

### Prerequisites

- [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0)
- [Node.js 20+](https://nodejs.org/) and npm
- [SQL Server](https://www.microsoft.com/en-us/sql-server/) (local or Docker)

### Backend Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-username/MyApp.Api.git
cd MyApp.Api

# 2. Update the connection string in appsettings.json
#    (modify "DefaultConnection" to point to your SQL Server instance)

# 3. Apply database migrations
dotnet ef database update

# 4. Run the API
dotnet run
```

The API will start at `https://localhost:5001` (or the port configured in `launchSettings.json`).

### Frontend Setup

```bash
# 1. Navigate to the frontend directory
cd myapp-frontend

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

The frontend will start at `http://localhost:5173` by default.

### Docker

```bash
# Build and run the container
docker build -t myapp-api .
docker run -p 8080:8080 myapp-api
```

---

## API Endpoints

### Companies

| Method | Endpoint | Description |
|--------|------------------------|--------------------------|
| GET | `/api/companies` | List all companies |
| GET | `/api/companies/{id}` | Get company by ID |
| POST | `/api/companies` | Create a new company |
| PUT | `/api/companies/{id}` | Update a company |
| DELETE | `/api/companies/{id}` | Delete a company |

### Clients

| Method | Endpoint | Description |
|--------|----------------------|--------------------------|
| GET | `/api/clients` | List all clients |
| GET | `/api/clients/{id}` | Get client by ID |
| POST | `/api/clients` | Create a new client |
| DELETE | `/api/clients/{id}` | Delete a client |

### Delivery Challans

| Method | Endpoint | Description |
|--------|---------------------------------------------------|---------------------------------------|
| GET | `/api/deliverychallans/company/{companyId}` | List challans for a company |
| POST | `/api/deliverychallans/company/{companyId}` | Create a challan for a company |

### Lookups

| Method | Endpoint | Description |
|--------|------------------------|--------------------------------------|
| GET | `/api/lookup/items` | Get item description suggestions |
| POST | `/api/lookup/items` | Add a new item description |
| GET | `/api/lookup/units` | Get unit suggestions |
| POST | `/api/lookup/units` | Add a new unit |

---

## Project Structure

```
MyApp.Api/
├── Controllers/
│   ├── ClientsController.cs
│   ├── CompaniesController.cs
│   ├── DeliveryChallansController.cs
│   └── LookupController.cs
├── DTOs/                          # Data Transfer Objects
├── Models/
│   ├── Client.cs
│   ├── Company.cs
│   ├── DeliveryChallan.cs
│   ├── DeliveryItem.cs
│   ├── ItemDescription.cs
│   └── Unit.cs
├── Services/
│   ├── Interfaces/
│   └── Implementations/
├── Repositories/
│   ├── Interfaces/
│   └── Implementations/
├── Data/
│   ├── AppDbContext.cs
│   └── AppDbContextFactory.cs
├── Migrations/
├── Properties/
├── myapp-frontend/                # React SPA
│   └── src/
│       ├── api/                   # API client functions
│       ├── Components/
│       │   ├── ChallanForm.jsx
│       │   ├── ChallanList.jsx
│       │   ├── ChallanModal.jsx
│       │   ├── ClientForm.jsx
│       │   ├── ClientList.jsx
│       │   ├── CompanyForm.jsx
│       │   ├── CompanyList.jsx
│       │   ├── LookupAutocomplete.jsx
│       │   └── SelectDropdown.jsx
│       ├── pages/
│       │   ├── ChallanPage.jsx
│       │   ├── ClientsPage.jsx
│       │   └── CompanyPage.jsx
│       ├── App.jsx
│       └── main.jsx
├── Dockerfile
├── Program.cs
├── MyApp.Api.csproj
├── MyApp.Api.sln
├── appsettings.json
└── appsettings.Development.json
```

---

## Roadmap

- [ ] Edit and delete existing delivery challans
- [ ] User authentication and authorization (ASP.NET Identity / JWT)
- [ ] Server-side pagination and sorting
- [ ] Print-friendly challan view / PDF export
- [ ] Dashboard analytics (challan counts, trends, top clients)
- [ ] Bulk import/export (CSV, Excel)
- [ ] Audit log for challan changes
- [ ] Dark mode support

---

## Contributing

Contributions are welcome! Please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
