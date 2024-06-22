import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import './map.css'; // Make sure to import the CSS file for styling
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Draw } from 'ol/interaction';
import { transform, fromLonLat } from 'ol/proj';
import axios from 'axios'; // Import Axios for API requests
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';

function MapComponent() {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [draw, setDraw] = useState(null);
  const [geoJSONFeatures, setGeoJSONFeatures] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState('NDVI');
  const [selectedDate, setSelectedDate] = useState('');

  useEffect(() => {
    const vectorSource = new VectorSource({ wrapX: false });

    const vectorLayer = new VectorLayer({
      source: vectorSource,
    });

    const mapObject = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
        vectorLayer,
      ],
      view: new View({
        center: fromLonLat([83.939, 28.265]), // Centered on the approximate location of your GeoJSON data
        zoom: 12, // Adjust zoom level as needed
      }),
    });

    setMap(mapObject);

    return () => {
      if (mapObject) {
        mapObject.setTarget(null);
      }
    };
  }, []);

  const addDrawInteraction = () => {
    if (map) {
      const drawInteraction = new Draw({
        source: map.getLayers().getArray()[1].getSource(),
        type: 'Polygon',
      });

      map.addInteraction(drawInteraction);
      setDraw(drawInteraction);

      drawInteraction.on('drawend', function (event) {
        const polygon = event.feature.getGeometry();
        const coordinates = polygon.getCoordinates()[0]; // Get the first ring of coordinates

        // Convert projected coordinates (EPSG:3857) to WGS84 (EPSG:4326)
        const wgs84Coordinates = coordinates.map(coord => transform(coord, 'EPSG:3857', 'EPSG:4326'));

        // Create GeoJSON structure
        const geojson = {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [wgs84Coordinates], // Wrap in an array for Polygon coordinates
          },
          properties: {}, // Optional properties
        };

        console.log('Drawn Polygon GeoJSON:', JSON.stringify(geojson));
      });
    }
  };

  const removeDrawInteraction = () => {
    if (map && draw) {
      map.removeInteraction(draw);
      setDraw(null);
    }
  };

  const clearDrawnFeatures = () => {
    if (map) {
      const vectorLayer = map.getLayers().getArray()[1];
      vectorLayer.getSource().clear();
    }
  };

  const fetchGeoJSONData = async () => {
    try {
      const response = await axios.get(`http://127.0.0.1:8000/api/indices/${selectedIndex.toLowerCase()}/`, {
        params: {
          date: selectedDate
        }
      });
      const { features } = response.data;

      // Iterate through features and create OpenLayers features
      const olFeatures = features.map(feature => {
        const coordinates = feature.geometry.coordinates[0].map(coord => fromLonLat(coord));

        const olFeature = new Feature({
          geometry: new Polygon([coordinates]),
          properties: feature.properties, // Optionally include properties
        });

        return olFeature;
      });

      // Set GeoJSON features state
      setGeoJSONFeatures(olFeatures);

      // Add features to vector source
      map.getLayers().getArray()[1].getSource().addFeatures(olFeatures);
    } catch (error) {
      console.error('Error fetching GeoJSON data:', error);
    }
  };

  useEffect(() => {
    if (map) {
      fetchGeoJSONData(); // Call fetchGeoJSONData when map is ready
    }
  }, [map]);

  const handleIndexChange = (event) => {
    setSelectedIndex(event.target.value);
  };

  const handleDateChange = (event) => {
    setSelectedDate(event.target.value);
  };

  const handleFetchData = () => {
    fetchGeoJSONData();
  };

  return (
    <div className="map-wrapper">
      <div className="sidebar">
        <h3>Indices</h3>
        <label>
          <input
            type="radio"
            value="NDVI"
            checked={selectedIndex === 'NDVI'}
            onChange={handleIndexChange}
          />
          NDVI
        </label>
        <label>
          <input
            type="radio"
            value="NDWI"
            checked={selectedIndex === 'NDWI'}
            onChange={handleIndexChange}
          />
          NDWI
        </label>
        <label>
          <input
            type="radio"
            value="LST"
            checked={selectedIndex === 'LST'}
            onChange={handleIndexChange}
          />
          LST
        </label>
        <div>
        <h3>Select Date</h3>
        <input type="date" value={selectedDate} onChange={handleDateChange} />
        </div>
        
        <button onClick={handleFetchData}>Fetch Data</button>
      </div>
      <div ref={mapRef} className="map-container"></div>
      <div className="buttons">
        <button onClick={addDrawInteraction}>Draw Polygon</button>
        <button onClick={removeDrawInteraction}>Stop Drawing</button>
        <button onClick={clearDrawnFeatures}>Clear Drawing</button>
      </div>
    </div>
  );
}

export default MapComponent;
