# PlateUp 🍽️

### AI-Powered Surplus Food Marketplace

PlateUp is a web-based platform that connects restaurants, cafés, bakeries, and other food businesses with customers to reduce food waste by selling surplus food at discounted prices.

The platform uses artificial intelligence to predict potential food surplus, recommend suitable rescue prices, and provide personalized food recommendations to customers.

---

## 🎯 Project Overview

Every day, food businesses prepare more food than they are able to sell. Much of this surplus food is discarded even though it is still safe and suitable for consumption.

PlateUp aims to address this problem by creating a digital marketplace where businesses can list surplus food at discounted prices and customers can discover and purchase these items before they become waste.

The platform combines a surplus food marketplace with AI-powered decision support for food businesses and personalized recommendations for customers.

---

## 🚀 Key Features

### 👤 Customer

- User registration and authentication
- Browse available surplus food
- Search and filter food listings
- Discover nearby food businesses
- View original and discounted prices
- Place food reservations/orders
- View order history
- Receive personalized food recommendations
- Submit reviews and ratings

### 🏪 Food Business

- Business registration and authentication
- Create and manage food listings
- Specify surplus quantity and availability time
- Set original food prices
- Manage orders and reservations
- Monitor surplus inventory
- View sales and surplus analytics
- Receive AI-based demand predictions
- Receive AI-recommended rescue prices

### 🤖 AI Features

- **Surplus Demand Prediction**  
  Predict the expected demand for food items using historical sales data.

- **Dynamic Pricing Recommendation**  
  Recommend suitable discounted prices based on predicted demand, remaining quantity, and remaining availability time.

- **Personalized Recommendations**  
  Recommend surplus food to customers based on their preferences, previous orders, price range, and location.

### 👨‍💼 Administrator

- Manage customers and food businesses
- Manage food listings
- Monitor orders and platform activity
- Manage reported content
- View platform statistics and analytics

---

## 🛠️ Technology Stack

| Component | Technology |
|-----------|------------|
| Frontend | React.js |
| Styling | Tailwind CSS |
| Backend | Node.js |
| API | Django REST Framework |
| Database | PostgreSQL |
| AI/ML | Python + Scikit-learn |
| Version Control | Git + GitHub |

---

## 🏗️ System Architecture

                    PlateUp
                       │
          ┌────────────┴────────────┐
          │                         │
      Customer                Food Business
          │                         │
          └────────────┬────────────┘
                       │
                 React Frontend
                       │
                    Node.js backend
                       │
              ┌────────┴────────┐
              │                 │
         PostgreSQL        AI/ML Service
                                │
                         Python/Scikit-learn
                                │
                    ┌───────────┴───────────┐
                    │                       │
             Demand Prediction      Price Recommendation
