# Truck-Booking-App - Complete Documentation

## Project Overview

This is a Flask-based web application for booking and tracking truck deliveries. The system allows users to book trucks for cargo transport between predefined locations, and drivers can accept rides and track their progress. The application uses real-time route optimization, cost calculation, and vehicle movement simulation.

---

## 🚀 Advanced Features Added (V2)

The application has been upgraded with the following advanced features:

1. **SQLite Database Migration**: Replaced the legacy `data.json` flat file with a thread-safe SQLite database (`app.db`). This allows concurrent background simulations without data corruption and provides relational tables for Vehicles, Bookings, Booking Stops, and Locations.
2. **Intermediate Routing & Stops**: Users can add multiple intermediate stops to their route. The routing engine chains these points together to construct a multi-leg journey.
3. **Driver Halt Management**: Drivers can report their arrival and departure at each intermediate stop. The system accrues a halt penalty (₹100/hr) during wait times.
4. **Mixed Truck Configurations**: Instead of single-truck type autoscaling, users can manually select unique combinations of Light, Small, and Big trucks. The backend perfectly scales the fare across the mixture.
5. **Spatial Road Constraints**: If a route contains known narrow streets (e.g., "Hostel-12", "Narrow Street"), the backend proactively blocks allocations involving Big Trucks, forcing users to use smaller fleet mixes.
6. **Mumbai-wide Locations**: The location database was expanded from 4 demo points to 40+ real coordinates spanning South Mumbai, the Western Suburbs, the Eastern Suburbs, and Navi Mumbai.

---

## File-by-File Breakdown

### 1. backend/app.py - Main Flask Application

**Libraries Used:**
- `flask` - Web framework for creating routes and serving templates
- `flask_cors` - Enables Cross-Origin Resource Sharing (CORS) for API access
- `os` - Operating system interface for environment variables and file paths
- `send_from_directory` - Flask utility to serve static files

**Lines 1-6: Import Statements**
- Line 1: Imports Flask core classes (Flask, render_template, jsonify, send_from_directory)
- Line 2: Imports CORS middleware to allow cross-origin requests
- Line 3: Imports user routes blueprint from backend.routes.user_routes module
- Line 4: Imports driver routes blueprint from backend.routes.driver_routes module
- Line 5: Imports os module for environment variables and path operations
- Line 6: Imports start_simulation function for manual simulation triggering

**Line 8: Flask App Initialization**
- Creates Flask application instance
- Sets template folder to "../frontend/templates" (relative to backend directory)
- Sets static folder to "../frontend/static" for CSS, JS, and images

**Line 9: CORS Configuration**
- Enables CORS for all routes, allowing frontend to make API calls from different origins

**Lines 11-12: Blueprint Registration**
- Line 11: Registers user_bp blueprint with URL prefix "/api/user"
- Line 12: Registers driver_bp blueprint with URL prefix "/api/driver"
- Blueprints organize routes into logical groups

**Lines 14-16: Index Route**
- Line 14: Defines route decorator for root path "/"
- Line 15: Function index() handles GET requests to homepage
- Line 16: Renders and returns index.html template

**Lines 18-20: User Panel Route**
- Line 18: Defines route for "/user_panel"
- Line 19: Function user_panel() handles requests
- Line 20: Renders user_panel.html template for booking interface

**Lines 22-24: Driver Panel Route**
- Line 22: Defines route for "/driver_panel"
- Line 23: Function driver_panel() handles requests
- Line 24: Renders driver_panel.html template for driver interface

**Lines 26-28: Map View Route**
- Line 26: Defines route for "/map_view"
- Line 27: Function map_view() handles requests
- Line 28: Renders map_view.html template for standalone map display

**Lines 30-33: Database Endpoint**
- Line 30: Defines route for "/api/db" (GET request)
- Line 31: Function get_db() serves the data.json file
- Line 32: Constructs path to database directory using os.path.join
- Line 33: Uses send_from_directory to serve data.json as static file

**Lines 35-38: Simulation Endpoint**
- Line 35: Defines route for "/simulate/<booking_id>" (POST request)
- Line 36: Function run_simulation() accepts booking_id from URL
- Line 37: Calls start_simulation() to begin vehicle movement simulation
- Line 38: Returns JSON response confirming simulation start

**Lines 40-42: Application Entry Point**
- Line 40: Checks if script is run directly (not imported)
- Line 41: Gets PORT from environment variable, defaults to 8000
- Line 42: Runs Flask app in debug mode on specified port

---

### 2. backend/models/booking.py - Booking Data Model

**Libraries Used:**
- `json` - For reading and writing JSON data
- `os` - For path operations
- `pathlib.Path` - Object-oriented path handling

**Lines 1-3: Import and Database Path Setup**
- Line 1: Imports json module for JSON operations
- Line 2: Imports os module
- Line 3: Imports Path class from pathlib for path manipulation
- Line 3: Defines DB constant as path to data.json file
- Uses Path.resolve() to get absolute path, then navigates to database folder

**Function: load_db()**
- **Lines 5-17:** Loads JSON database file
- Line 5: Function definition with no parameters
- Line 6: Docstring describing function purpose
- Line 7: Wraps file operations in try-except for error handling
- Line 8: Opens data.json file in read mode
- Line 9: Reads file content and strips whitespace to prevent JSON parsing errors
- Line 10: Parses JSON string into Python dictionary
- Line 11: Catches JSONDecodeError if file contains invalid JSON
- Line 12: Prints error message to console
- Line 13: Comment explaining fallback behavior
- Line 14: Returns empty database structure if JSON is invalid
- Line 15: Catches any other unexpected exceptions
- Line 16: Prints generic error message
- Line 17: Returns empty database structure as fallback

**Function: save_db(db)**
- **Lines 19-21:** Saves database dictionary to JSON file
- Line 19: Function definition, accepts db dictionary parameter
- Line 20: Opens data.json file in write mode
- Line 21: Writes dictionary to file with indentation of 2 spaces for readability

**Function: list_bookings()**
- **Lines 23-25:** Retrieves all bookings from database
- Line 23: Function definition
- Line 24: Loads entire database
- Line 25: Returns bookings list from database, defaults to empty list if missing

**Function: get_booking(bid)**
- **Lines 27-32:** Finds specific booking by ID
- Line 27: Function definition, accepts booking_id parameter
- Line 28: Loads database
- Line 29: Iterates through all bookings in database
- Line 30: Checks if current booking's ID matches requested ID
- Line 31: Returns matching booking dictionary
- Line 32: Returns None if booking not found

**Function: create_booking(b)**
- **Lines 34-37:** Creates new booking in database
- Line 34: Function definition, accepts booking dictionary
- Line 35: Loads current database
- Line 36: Ensures "bookings" key exists, then appends new booking
- Line 37: Saves updated database to file

**Function: update_booking(bid, fields)**
- **Lines 39-47:** Updates existing booking with new field values
- Line 39: Function definition, accepts booking_id and fields dictionary
- Line 40: Loads database
- Line 41: Iterates through bookings with index using enumerate
- Line 42: Checks if booking ID matches
- Line 43: Updates booking dictionary with new fields using update() method
- Line 44: Replaces booking in list at same index
- Line 45: Saves updated database
- Line 46: Returns updated booking
- Line 47: Returns None if booking not found

---

### 3. backend/models/vehicle.py - Vehicle Data Model

**Libraries Used:**
- `os` - For path operations
- `json` - For JSON operations
- Relative import from `.booking` module

**Lines 1-3: Import Statements**
- Line 1: Imports os module
- Line 2: Imports json module
- Line 3: Imports load_db and save_db functions from booking module using relative import

**Function: get_vehicle(vid)**
- **Lines 8-13:** Retrieves vehicle by ID
- Line 8: Function definition, accepts vehicle_id parameter
- Line 9: Loads database using imported function
- Line 10: Iterates through vehicles list from database
- Line 11: Checks if vehicle ID matches requested ID
- Line 12: Returns matching vehicle dictionary
- Line 13: Returns None if vehicle not found

**Function: update_vehicle_position(vid, lat, lng)**
- **Lines 19-34:** Updates vehicle's geographic coordinates
- Line 19: Function definition, accepts vehicle_id, latitude, and longitude
- Line 20: Loads database
- Line 21: Gets vehicles list from database
- Line 22: Iterates through vehicles with index
- Line 23: Checks if vehicle ID matches
- Line 24: Updates latitude coordinate
- Line 25: Updates longitude coordinate
- Line 26: Replaces vehicle in list
- Line 27: Saves database with updated position
- Line 28: Returns updated vehicle
- Line 29: Comment indicating fallback behavior
- Line 30: Creates new vehicle entry if not found
- Line 31: Appends new vehicle to list
- Line 32: Updates vehicles in database dictionary
- Line 33: Saves database
- Line 34: Returns newly created vehicle

**Function: update_vehicle(vid, updates)**
- **Lines 40-48:** Updates any vehicle attributes
- Line 40: Function definition, accepts vehicle_id and updates dictionary
- Line 41: Loads database
- Line 42: Gets vehicles list
- Line 43: Iterates through vehicles
- Line 44: Checks if vehicle ID matches
- Line 45: Updates vehicle with new attributes
- Line 46: Saves database
- Line 47: Returns updated vehicle
- Line 48: Returns None if vehicle not found

**Function: get_all_vehicles()**
- **Lines 54-56:** Retrieves all vehicles from database
- Line 54: Function definition
- Line 55: Loads database
- Line 56: Returns vehicles list, defaults to empty list if missing

---

### 4. backend/services/cost_calculator.py - Pricing Logic

**Libraries Used:**
- `datetime` - For getting current time to calculate traffic factors

**Lines 3-4: Pricing Constants**
- Line 3: BASE_RATE_PER_KM - Base charge per kilometer (30.0 rupees)
- Line 4: FIXED_CHARGE - Fixed base charge regardless of distance (150.0 rupees)

**Function: traffic_factor()**
- **Lines 6-12:** Calculates traffic multiplier based on time of day
- Line 6: Function definition with no parameters
- Line 7: Gets current hour (0-23) from datetime.now()
- Line 8: Checks if hour is in morning rush (8-10) or evening rush (17-19)
- Line 9: Returns 1.25 multiplier (25% surcharge) for peak hours
- Line 10: Checks if hour is lunch time (12-13)
- Line 11: Returns 1.1 multiplier (10% surcharge) for moderate traffic
- Line 12: Returns 1.0 (no surcharge) for other times

**Function: weight_multiplier(weight_kg)**
- **Lines 14-17:** Calculates weight-based pricing multiplier
- Line 14: Function definition, accepts weight in kilograms
- Line 15: Defines step size of 1000kg for weight tiers
- Line 16: Calculates number of 1000kg steps (integer division)
- Line 17: Returns 1.15 raised to power of steps, or 1.0 if weight < 1000kg
- Each 1000kg adds 15% to the cost

**Function: calculate_cost(distance_km, weight_kg)**
- **Lines 19-21:** Calculates total trip cost
- Line 19: Function definition, accepts distance and weight
- Line 20: Calculates base cost: (rate per km × distance) + fixed charge
- Line 21: Multiplies base by traffic factor and weight multiplier
- Returns final cost as float

---

### 5. backend/services/route_optimizer.py - Route Calculation

**Libraries Used:**
- `os` - For environment variables
- `requests` - For HTTP API calls to routing services
- `dotenv` - For loading environment variables from .env file
- `math` - For haversine distance calculation (imported conditionally)

**Lines 1-5: Import and Configuration**
- Line 1: Imports os and requests modules
- Line 2: Imports load_dotenv function
- Line 3: Loads environment variables from .env file
- Line 4: Gets OpenRouteService API key from environment
- Line 5: Defines OpenRouteService API endpoint URL

**Function: get_route_info(start_lnglat, end_lnglat)**
- **Lines 7-52:** Gets route information between two points
- Line 7: Function definition, accepts start and end coordinates as [lng, lat]
- Line 8: Comment explaining coordinate format
- Line 9: Comment indicating routing priority order
- Line 10: Checks if OpenRouteService API key exists
- Line 11: Sets HTTP headers with API key authorization
- Line 12: Creates request body with coordinate pairs
- Line 13: Wraps API call in try-except for error handling
- Line 14: Makes POST request to OpenRouteService API with 10 second timeout
- Line 15: Raises exception if HTTP status indicates error
- Line 16: Parses JSON response
- Line 17: Extracts first feature from response
- Line 18: Gets route summary (distance, duration) from feature properties
- Line 19: Gets GeoJSON geometry (route coordinates) from feature
- Line 20: Returns dictionary with distance (meters), duration (seconds), and GeoJSON
- Line 21: Catches any exceptions from OpenRouteService
- Line 22: Passes silently to try next fallback
- Line 23: Comment indicating fallback to OSRM
- Line 24: Wraps OSRM call in try-except
- Line 25: Extracts longitude and latitude from start coordinates
- Line 26: Extracts longitude and latitude from end coordinates
- Line 27: Constructs OSRM API URL with coordinates
- Line 28: Formats URL string with coordinate values
- Line 29: Completes URL with query parameters for full geometry
- Line 30: Makes GET request to OSRM public server
- Line 31: Raises exception if HTTP error occurs
- Line 32: Parses JSON response
- Line 33: Extracts first route from response
- Line 34: Gets distance in meters from route
- Line 35: Gets duration in seconds from route
- Line 36: Gets GeoJSON geometry from route
- Line 37: Returns dictionary with OSRM route data
- Line 38: Catches exceptions from OSRM
- Line 39: Comment indicating last-resort fallback
- Line 40: Imports math functions for haversine calculation
- Line 41: Extracts coordinates again
- Line 42: Defines nested haversine function
- Line 43: Converts degrees to radians for all coordinates
- Line 44: Calculates longitude and latitude differences
- Line 45: Calculates haversine formula intermediate value 'a'
- Line 46: Calculates central angle 'c' using arcsine
- Line 47: Converts to kilometers using Earth's radius (6371km)
- Line 48: Returns distance in kilometers
- Line 49: Calls haversine function with coordinates
- Line 50: Converts kilometers to meters
- Line 51: Estimates duration assuming 30 km/h average speed
- Line 52: Returns dictionary with distance, duration, and None for geometry (no route line)

---

### 6. backend/services/simulator.py - Vehicle Movement Simulation

**Libraries Used:**
- `time` - For sleep delays between position updates
- `threading` - For running simulation in background threads
- `traceback` - For printing detailed error information

**Lines 6-7: Thread Tracking**
- Line 6: Comment explaining purpose of thread dictionary
- Line 7: Dictionary to store active simulation threads, prevents duplicate simulations

**Function: simulate_move_along_route(booking_id, phase)**
- **Lines 9-90:** Simulates vehicle moving along route coordinates
- Line 9: Function definition, accepts booking_id and phase ("to_pickup" or "to_drop")
- Lines 10-12: Docstring explaining function purpose and parameters
- Line 14: Wraps entire function in try-except for error handling
- Line 15: Retrieves booking from database
- Line 16: Checks if booking exists
- Line 17: Prints error message if booking not found
- Line 18: Returns early if booking missing
- Line 19: Checks if phase is "to_pickup"
- Line 20: Gets route geometry for pickup leg (to_pickup_geojson or fallback)
- Line 21: Else clause for "to_drop" phase
- Line 22: Gets route geometry for drop leg
- Line 23: Checks if geometry exists
- Line 24: Prints error if no route geometry
- Line 25: Returns early if no geometry
- Line 26: Extracts coordinate array from GeoJSON geometry
- Line 27: Checks if coordinates exist
- Line 28: Prints error if no coordinates
- Line 29: Returns early if no coordinates
- Line 30: Gets assigned vehicle ID from booking, defaults to "TRUCK-1"
- Line 31: Comment explaining coordinate sampling
- Line 32: Comment about sampling threshold
- Line 33: Gets total number of coordinate points
- Line 34: Checks if route has more than 200 points
- Line 35: Calculates step size to sample down to ~200 points
- Line 36: Samples coordinates using slice with step
- Line 37: Prints log message about sampling
- Line 38: Prints simulation start message with waypoint count
- Line 39: Comment about adaptive sleep timing
- Line 40: Sets base sleep time to 0.8 seconds
- Line 41: Checks if route has more than 100 points
- Line 42: Reduces sleep to 0.5 seconds for very long routes
- Line 43: Else-if for routes with more than 50 points
- Line 44: Sets sleep to 0.6 seconds for medium routes
- Line 45: Iterates through coordinates with index
- Line 46: Wraps position update in try-except
- Line 47: Extracts longitude and latitude from coordinate
- Line 48: Updates vehicle position in database
- Line 49: Empty line for readability
- Line 50: Comment about progress logging
- Line 51: Calculates if current waypoint is at 20% milestone
- Line 52: Calculates progress percentage
- Line 53: Prints progress message
- Line 54: Sleeps for calculated duration to simulate movement
- Line 55: Catches exceptions during position update
- Line 56: Prints error message with waypoint index
- Line 57: Comment explaining error recovery
- Line 58: Continues to next waypoint instead of stopping
- Line 59: Comment about final position
- Line 60: Checks if coordinates exist
- Line 61: Gets last coordinate from array
- Line 62: Wraps final update in try-except
- Line 63: Updates vehicle to final destination position
- Line 64: Catches exceptions during final update
- Line 65: Prints error message
- Line 66: Checks if phase is "to_pickup"
- Line 67: Updates booking status to "ARRIVED_DRIVER"
- Line 68: Prints arrival message
- Line 69: Else clause for "to_drop" phase
- Line 70: Updates booking status to "COMPLETED"
- Line 71: Prints completion message
- Line 72: Catches any fatal exceptions
- Line 73: Prints error message with booking and phase
- Line 74: Imports traceback module
- Line 75: Prints full stack trace for debugging
- Line 76: Finally block for cleanup
- Line 77: Comment about thread cleanup
- Line 78: Creates thread key from booking_id and phase
- Line 79: Checks if thread key exists in tracking dictionary
- Line 80: Deletes thread reference from dictionary

**Function: start_to_pickup(booking_id)**
- **Lines 92-108:** Starts simulation thread for pickup leg
- Line 92: Function definition
- Line 93: Docstring explaining function purpose
- Line 94: Creates thread key for tracking
- Line 95: Comment about duplicate prevention
- Line 96: Checks if thread already exists
- Line 97: Gets existing thread from dictionary
- Line 98: Checks if thread is still running
- Line 99: Prints message if already running
- Line 100: Returns early to prevent duplicate
- Line 101: Defines nested function to run in thread
- Line 102: Calls simulate_move_along_route with "to_pickup" phase
- Line 103: Creates Thread object with target function
- Line 104: Sets thread name for debugging
- Line 105: Sets daemon to False so thread completes even if main exits
- Line 106: Stores thread reference in tracking dictionary
- Line 107: Starts thread execution
- Line 108: Prints confirmation message

**Function: start_to_drop(booking_id)**
- **Lines 111-127:** Starts simulation thread for drop leg
- Line 111: Function definition
- Line 112: Docstring explaining function purpose
- Line 113: Creates thread key for drop phase
- Line 114: Comment about duplicate prevention
- Line 115: Checks if thread already exists
- Line 116: Gets existing thread
- Line 117: Checks if thread is alive
- Line 118: Prints message if already running
- Line 119: Returns early
- Line 120: Defines nested run function
- Line 121: Calls simulate_move_along_route with "to_drop" phase
- Line 122: Creates Thread object
- Line 123: Sets thread name
- Line 124: Sets daemon to False
- Line 125: Stores thread reference
- Line 126: Starts thread
- Line 127: Prints confirmation message

**Function: start_simulation(booking_id)**
- **Lines 130-148:** Legacy function for full simulation flow
- Line 130: Function definition
- Line 131: Docstring indicating legacy/debugging purpose
- Line 132: Creates thread key for full simulation
- Line 133: Checks if thread exists
- Line 134: Gets existing thread
- Line 135: Checks if alive
- Line 136: Prints message if running
- Line 137: Returns early
- Line 138: Defines nested run function
- Line 139: Runs pickup simulation
- Line 140: Waits 1 second
- Line 141: Sets status to LOADED
- Line 142: Runs drop simulation
- Line 143: Creates Thread object
- Line 144: Sets thread name
- Line 145: Sets daemon to False
- Line 146: Stores thread reference
- Line 147: Starts thread
- Line 148: Prints confirmation message

**Function: list_active_simulations()**
- **Lines 150-154:** Helper function for debugging
- Line 150: Function definition
- Line 151: Docstring explaining purpose
- Line 152: Loads database
- Line 153: Filters bookings that are not completed or cancelled
- Line 154: Returns list of active bookings

---

### 7. backend/routes/user_routes.py - User API Endpoints

**Libraries Used:**
- `flask` - Blueprint, request, jsonify for API endpoints
- `time` - For timestamp generation
- `uuid` - For generating unique booking IDs

**Lines 1-6: Import Statements**
- Line 1: Imports Flask components for creating API routes
- Line 2: Imports route_optimizer for calculating routes
- Line 3: Imports cost_calculator for pricing
- Line 4: Imports booking model functions
- Line 5: Imports time for timestamps
- Line 6: Imports uuid for unique ID generation

**Line 8: Blueprint Creation**
- Creates Flask Blueprint named "user_bp" for organizing user-related routes

**Function: get_locations()**
- **Lines 10-15:** Returns list of available pickup/drop locations
- Line 10: Route decorator for GET /api/user/locations
- Line 11: Function definition
- Line 12: Loads database
- Line 13: Gets locations dictionary from database
- Line 14: Converts dictionary to list of objects with name, lat, lng
- Line 15: Returns JSON response with locations array

**Function: estimate()**
- **Lines 17-40:** Calculates trip cost and route without creating booking
- Line 17: Route decorator for POST /api/user/estimate
- Line 18: Function definition
- Line 19: Gets JSON payload from request
- Line 20: Extracts pickup location name
- Line 21: Extracts drop location name
- Line 22: Extracts weight, converts to float, defaults to 0
- Line 23: Loads database
- Line 24: Validates that both locations exist in database
- Line 25: Returns error if location invalid
- Line 26: Gets pickup location coordinates from database
- Line 27: Gets drop location coordinates from database
- Line 28: Calls route_optimizer to get route info
- Line 29: Extracts distance in meters from route
- Line 30: Extracts duration in seconds from route
- Line 31: Calculates cost using distance and weight
- Line 32: Returns JSON with rounded distance, ETA, cost, and route GeoJSON
- Line 33: Converts distance from meters to kilometers, rounds to 3 decimals
- Line 34: Converts duration from seconds to minutes, rounds to 1 decimal
- Line 35: Rounds cost to 2 decimal places
- Line 36: Includes route GeoJSON for map display

**Function: book()**
- **Lines 42-79:** Creates new booking in database
- Line 42: Route decorator for POST /api/user/book
- Line 43: Function definition
- Line 44: Gets JSON payload
- Line 45: Extracts pickup location
- Line 46: Extracts drop location
- Line 47: Extracts weight
- Line 48: Loads database
- Line 49: Validates locations exist
- Line 50: Returns error if invalid
- Line 51: Gets pickup coordinates
- Line 52: Gets drop coordinates
- Line 53: Calculates route
- Line 54: Gets distance
- Line 55: Gets duration
- Line 56: Calculates cost
- Line 57: Creates booking dictionary
- Line 58: Generates unique booking ID using UUID
- Line 59: Stores pickup location name
- Line 60: Stores drop location name
- Line 61: Stores pickup coordinates as [lat, lng]
- Line 62: Stores drop coordinates as [lat, lng]
- Line 63: Stores weight
- Line 64: Converts distance to kilometers
- Line 65: Converts duration to minutes
- Line 66: Rounds cost
- Line 67: Sets initial status to "PENDING"
- Line 68: Sets assigned_vehicle to None (not yet accepted)
- Line 69: Stores route GeoJSON
- Line 70: Stores Unix timestamp of creation
- Line 71: Initializes driver_loaded flag to False
- Line 72: Initializes user_loaded flag to False
- Line 73: Saves booking to database
- Line 74: Returns JSON with created booking

**Function: bookings()**
- **Lines 81-83:** Returns all bookings
- Line 81: Route decorator for GET /api/user/bookings
- Line 82: Function definition
- Line 83: Returns JSON with all bookings list

**Function: booking_get(bid)**
- **Lines 85-90:** Returns specific booking by ID
- Line 85: Route decorator for GET /api/user/booking/<bid>
- Line 86: Function definition, accepts booking_id from URL
- Line 87: Retrieves booking from database
- Line 88: Checks if booking exists
- Line 89: Returns error if not found
- Line 90: Returns JSON with booking data

**Function: user_confirm_loaded()**
- **Lines 93-109:** Marks user's confirmation that cargo is loaded
- Line 93: Route decorator for POST /api/user/confirm_loaded
- Line 94: Function definition
- Line 95: Gets JSON payload, defaults to empty dict
- Line 96: Extracts booking_id
- Line 97: Validates booking_id provided
- Line 98: Returns error if missing
- Line 99: Retrieves booking
- Line 100: Validates booking exists
- Line 101: Returns error if not found
- Line 102: Updates booking with user_loaded = True
- Line 103: Comment explaining dual confirmation logic
- Line 104: Retrieves updated booking
- Line 105: Checks if both driver and user have confirmed
- Line 106: Sets status to "LOADED"
- Line 107: Imports start_to_drop function
- Line 108: Starts simulation to drop location
- Line 109: Returns success response

---

### 8. backend/routes/driver_routes.py - Driver API Endpoints

**Libraries Used:**
- `flask` - Blueprint, request, jsonify
- Same as user_routes for model and service imports

**Line 7: Blueprint Creation**
- Creates Flask Blueprint named "driver_bp" for driver-related routes

**Function: list_pending()**
- **Lines 10-14:** Returns list of pending (unaccepted) bookings
- Line 10: Route decorator for GET /api/driver/pending
- Line 11: Function definition
- Line 12: Loads database
- Line 13: Filters bookings with status "PENDING"
- Line 14: Returns JSON with pending bookings array

**Function: accept_booking(booking_id)**
- **Lines 16-45:** Driver accepts a booking and starts pickup simulation
- Line 16: Route decorator for POST /api/driver/accept/<booking_id>
- Line 17: Function definition, accepts booking_id from URL
- Line 18: Gets JSON payload, defaults to empty dict
- Line 19: Extracts vehicle_id, defaults to "TRUCK-1"
- Line 20: Retrieves booking from database
- Line 21: Validates booking exists
- Line 22: Returns error if not found
- Line 23: Comment about route calculation
- Line 24: Gets vehicle's current position
- Line 25: Checks if vehicle exists
- Line 26: Extracts pickup coordinates from booking
- Line 27: Calculates route from vehicle's current position to pickup
- Line 28: Sets to_pickup to None if vehicle not found
- Line 29: Creates update dictionary with status and vehicle assignment
- Line 30: Checks if route calculation succeeded and has GeoJSON
- Line 31: Adds to_pickup_geojson to updates
- Line 32: Comment about drop route
- Line 33: Checks if booking has route_geojson
- Line 34: Adds to_drop_geojson to updates (same as original route)
- Line 35: Updates booking with all new fields
- Line 36: Comment about simulation
- Line 37: Starts background thread to simulate movement to pickup
- Line 38: Returns success response with message and booking_id

**Function: accept_booking_json()**
- **Lines 48-56:** Alternative endpoint that accepts booking_id in JSON body
- Line 48: Route decorator for POST /api/driver/accept
- Line 49: Function definition
- Line 50: Gets JSON payload
- Line 51: Extracts booking_id from body
- Line 52: Extracts vehicle_id, defaults to "TRUCK-1"
- Line 53: Validates booking_id provided
- Line 54: Returns error if missing
- Line 55: Comment about reusing logic
- Line 56: Calls accept_booking function with extracted ID

**Function: update_driver_location(vehicle_id)**
- **Lines 58-67:** Manually updates vehicle position (for testing)
- Line 58: Route decorator for POST /api/driver/location/<vehicle_id>
- Line 59: Function definition, accepts vehicle_id from URL
- Line 60: Gets JSON payload
- Line 61: Extracts latitude
- Line 62: Extracts longitude
- Line 63: Validates both coordinates provided
- Line 64: Returns error if missing
- Line 65: Updates vehicle position in database
- Line 66: Returns updated vehicle data

**Function: complete_booking(booking_id)**
- **Lines 69-76:** Marks booking as completed
- Line 69: Route decorator for POST /api/driver/complete/<booking_id>
- Line 70: Function definition
- Line 71: Retrieves booking
- Line 72: Validates booking exists
- Line 73: Returns error if not found
- Line 74: Updates status to "COMPLETED"
- Line 75: Returns success message

**Function: update_status()**
- **Lines 79-90:** Generic status update endpoint
- Line 79: Route decorator for POST /api/driver/update_status
- Line 80: Function definition
- Line 81: Gets JSON payload
- Line 82: Extracts booking_id
- Line 83: Extracts status value
- Line 84: Validates both provided
- Line 85: Returns error if missing
- Line 86: Retrieves booking
- Line 87: Validates booking exists
- Line 88: Returns error if not found
- Line 89: Updates booking status
- Line 90: Returns success response

**Function: driver_mark_loaded()**
- **Lines 93-108:** Marks driver's confirmation that cargo is loaded
- Line 93: Route decorator for POST /api/driver/mark_loaded
- Line 94: Function definition
- Line 95: Gets JSON payload
- Line 96: Extracts booking_id
- Line 97: Validates booking_id provided
- Line 98: Returns error if missing
- Line 99: Retrieves booking
- Line 100: Validates booking exists
- Line 101: Returns error if not found
- Line 102: Updates booking with driver_loaded = True
- Line 103: Comment about dual confirmation
- Line 104: Retrieves updated booking
- Line 105: Checks if both confirmations received
- Line 106: Sets status to "LOADED"
- Line 107: Starts simulation to drop location
- Line 108: Returns success response

**Function: force_start_drop()**
- **Lines 111-124:** Safety endpoint to restart drop simulation if stuck
- Line 111: Route decorator for POST /api/driver/start_drop
- Line 112: Function definition
- Line 113: Docstring explaining idempotent safety purpose
- Line 114: Gets JSON payload
- Line 115: Extracts booking_id
- Line 116: Validates booking_id provided
- Line 117: Returns error if missing
- Line 118: Retrieves booking
- Line 119: Validates booking exists
- Line 120: Returns error if not found
- Line 121: Checks if status is "LOADED"
- Line 122: Starts drop simulation
- Line 123: Returns success with started flag
- Line 124: Returns success with started=false if not LOADED

---

## Frontend Files Overview

### 9. frontend/static/js/user.js - User Panel JavaScript

**Libraries Used:**
- Leaflet.js (via CDN) - For map display and markers
- Native JavaScript fetch API - For HTTP requests
- Browser localStorage API - For session persistence

**Key Variables:**
- `map` - Leaflet map instance
- `routeLayer`, `routeToPickupLayer` - Map layers for route display
- `vehicleMarker` - Marker for moving truck
- `pickupMarker`, `dropMarker` - Location markers
- `bookingId` - Current active booking ID
- `locationsByName` - Dictionary mapping location names to coordinates

**Function: init()**
- Initializes map, loads vehicles, populates location dropdowns
- Sets up event listeners for estimate and book buttons
- Starts polling interval for booking updates
- Restores session from localStorage if booking exists

**Function: estimate()**
- Sends request to /api/user/estimate
- Displays distance, ETA, and cost
- Shows route on map with pickup/drop markers

**Function: book()**
- Creates booking via /api/user/book
- Hides booking form, shows trip summary card
- Displays routes and markers on map
- Stores bookingId in localStorage

**Function: pollBooking()**
- Polls /api/user/booking/<id> every 2 seconds
- Updates status display
- Shows/hides "Mark Loaded" button based on status
- Updates vehicle marker position
- Handles completion cleanup

**Function: confirmUserLoaded()**
- Sends confirmation to /api/user/confirm_loaded
- Triggers drop simulation when both confirm

---

### 10. frontend/static/js/driver.js - Driver Panel JavaScript

**Libraries Used:**
- Same as user.js (Leaflet, fetch, localStorage)

**Key Variables:**
- Similar to user.js but with driver-specific state
- `currentBookingId` - Currently accepted booking
- `routeToPickupLayer`, `routeToDropLayer` - Separate route layers
- `staticMarkersById` - Dictionary of idle truck markers

**Function: init()**
- Initializes map with all vehicle markers
- Loads pending bookings list
- Sets up polling intervals
- Restores session if active booking exists

**Function: accept(bid)**
- Accepts booking via /api/driver/accept
- Removes static markers, shows moving marker
- Displays both routes (orange to pickup, blue to drop)
- Shows trip summary card

**Function: markLoaded()**
- Sends confirmation to /api/driver/mark_loaded
- Triggers drop simulation when both confirm

**Function: pollBookingStatus()**
- Polls booking status every 1.5 seconds
- Updates status display with waiting messages
- Shows/hides "Mark Loaded" button
- Redraws routes if missing
- Handles completion cleanup

**Function: pollVehicle()**
- Updates vehicle marker position every second
- In idle mode, updates all static vehicle markers

---

## Data Flow Summary

1. **User Books Trip:**
   - User selects pickup/drop → estimate() calculates route/cost
   - User clicks "Book" → book() creates PENDING booking
   - Booking stored in data.json with unique ID

2. **Driver Accepts:**
   - Driver sees pending list → clicks "Accept"
   - accept_booking() calculates route from truck to pickup
   - Updates booking to ACCEPTED, assigns vehicle
   - Starts background thread simulating movement to pickup

3. **Truck Arrives at Pickup:**
   - Simulation completes → status becomes ARRIVED_DRIVER
   - Both panels show "Mark Loaded" buttons
   - User and driver both confirm → status becomes LOADED
   - Starts simulation to drop location

4. **Trip Completion:**
   - Simulation completes → status becomes COMPLETED
   - User panel shows success message, form returns
   - Driver panel clears trip UI, shows idle trucks

---

## Key Design Patterns

1. **JSON File Database:** Simple file-based storage, no SQL required
2. **Background Threading:** Vehicle simulation runs in separate threads
3. **Session Persistence:** localStorage saves active bookings across page refreshes
4. **Progressive Enhancement:** Fallback routes if API services unavailable
5. **Dual Confirmation:** Both user and driver must confirm before proceeding
6. **Real-time Updates:** Polling intervals keep UI synchronized with backend state

---

## Error Handling Strategy

- Try-except blocks around all file I/O operations
- Graceful fallbacks for routing API failures
- Validation of all user inputs
- Thread safety with duplicate prevention
- Coordinate sampling for very long routes
- Progress logging for debugging

---

This documentation covers all backend Python files with line-by-line explanations. The frontend JavaScript files follow similar patterns with event-driven programming, DOM manipulation, and API communication.

