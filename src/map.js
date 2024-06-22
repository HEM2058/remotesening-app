import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import './map.css'; // Make sure to import the CSS file for styling
import { Map, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ'; // Import XYZ source for Google Maps
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import { Draw } from 'ol/interaction';
import { transform, fromLonLat } from 'ol/proj';
import axios from 'axios'; // Import Axios for API requests
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import Zoom from 'ol/control/Zoom';
import { Style, Fill, Stroke } from 'ol/style';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { parseISO, format, isBefore, isAfter, startOfDay, endOfDay } from 'date-fns';
import { FaSpinner } from 'react-icons/fa';

function MapComponent() {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [draw, setDraw] = useState(null);
  const [geoJSONFeatures, setGeoJSONFeatures] = useState([]);
  const [drawnGeoJSON, setDrawnGeoJSON] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState('NDVI');
  const [selectedDate, setSelectedDate] = useState(null); // Change to null
  const [availableDates, setAvailableDates] = useState([]); // State to store available dates
  const [cloudCover, setCloudCover] = useState(100); // State to store cloud cover value
  const [fetchDataRequired, setFetchDataRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false); // State to track loading of available dates
  const [baseLayer, setBaseLayer] = useState('google'); // State to track current base layer
  const [legendColors, setLegendColors] = useState({}); // State to store legend colors

  useEffect(() => {
    const vectorSource = new VectorSource({ wrapX: false });

    const vectorLayer = new VectorLayer({
      source: vectorSource,
    });

    const googleSource = new XYZ({
      url: 'http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', // Google Satellite tiles URL
      maxZoom: 19, // Adjust max zoom level as needed
    });

    const googleLayer = new TileLayer({
      source: googleSource,
    });

    const osmLayer = new TileLayer({
      source: new OSM(),
    });

    const mapObject = new Map({
      target: mapRef.current,
      layers: baseLayer === 'google' ? [googleLayer, vectorLayer] : [osmLayer, vectorLayer], // Initial base layer selection
      view: new View({
        center: fromLonLat([-85.6024, 12.7690]),
        zoom: 15,
      }),
      controls: [],
    });

    const zoomControl = new Zoom({
      className: 'ol-zoom',
    });
    mapObject.addControl(zoomControl);

    setMap(mapObject);

    return () => {
      if (mapObject) {
        mapObject.setTarget(null);
      }
    };
  }, [baseLayer]); // Re-render the map when baseLayer state changes

  const addDrawInteraction = () => {
    if (map) {
      const drawInteraction = new Draw({
        source: map.getLayers().getArray()[1].getSource(), // Use the vector layer's source for drawing
        type: 'Polygon',
      });

      map.addInteraction(drawInteraction);
      setDraw(drawInteraction);

      drawInteraction.on('drawend', function (event) {
        const polygon = event.feature.getGeometry();
        const coordinates = polygon.getCoordinates()[0];

        const wgs84Coordinates = coordinates.map(coord => transform(coord, 'EPSG:3857', 'EPSG:4326'));

        const geojson = {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [wgs84Coordinates],
          },
          properties: {},
        };

        console.log('Drawn Polygon GeoJSON:', JSON.stringify(geojson));

        setDrawnGeoJSON(geojson);
        fetchAvailableDates(geojson, cloudCover);
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
      setDrawnGeoJSON(null);
      setAvailableDates([]);
      setFetchDataRequired(false);
      setGeoJSONFeatures([]);
      setLegendColors({});
    }
  };

  const generateColorMapping = (classes) => {
    const colors = [
      '#ff0000', '#00ff00', '#0000ff', '#ffff00', 
      '#ff00ff', '#00ffff', '#800000', '#808000',
      '#800080', '#008080', '#000080', '#808080'
    ];

    const colorMapping = {};
    classes.forEach((className, index) => {
      colorMapping[className] = colors[index % colors.length];
    });

    return colorMapping;
  };

  const fetchGeoJSONData = async () => {
    setLoading(true);

    try {
      if (!selectedIndex || !selectedDate || !drawnGeoJSON) {
        return;
      }

      removeDrawInteraction();

      const response = await axios.post(`http://127.0.0.1:8000/api/indices/${selectedIndex.toLowerCase()}/`, {
        date: selectedDate,
        geometry: drawnGeoJSON,
      });
      console.log(response.data)
      const { features } = response.data;

      const classes = [...new Set(features.map(feature => feature.properties.class_no))];
      console.log(classes)
      const colorMapping = generateColorMapping(classes);
      console.log(colorMapping)
      setLegendColors(colorMapping);

      const olFeatures = features.map(feature => {
        const coordinates = feature.geometry.coordinates[0].map(coord => fromLonLat(coord));

        const olFeature = new Feature({
          geometry: new Polygon([coordinates]),
          properties: feature.properties,
        });

        olFeature.setStyle(new Style({
          fill: new Fill({
            color: colorMapping[feature.properties.class],
          }),
          stroke: new Stroke({
            color: '#000000',
            width: 1,
          }),
        }));

        return olFeature;
      });

      setGeoJSONFeatures(olFeatures);

      map.getLayers().getArray()[1].getSource().addFeatures(olFeatures);
    } catch (error) {
      console.error('Error fetching GeoJSON data:', error);
      toast.error(`Error fetching GeoJSON data: ${error.message}`);
    } finally {
      setLoading(false);
      setFetchDataRequired(false);
    }
  };

  const fetchAvailableDates = async (geojson, cloudCover) => {
    setLoadingDates(true);
    try {
      const response = await axios.post('http://127.0.0.1:8000/api/indices/sentinel-data-availability/', {
        geometry: geojson,
        cloud_coverage: cloudCover,
        end_date: "2024-06-22"
      });
      console.log(response.data);
      const dates = response.data;
      setAvailableDates(dates.map(date => parseISO(date))); // Parse the dates to Date objects
    } catch (error) {
      console.error('Error fetching available dates:', error);
      toast.error(`Error fetching available dates: ${error.message}`);
    } finally {
      setLoadingDates(false);
    }
  };

  useEffect(() => {
    if (fetchDataRequired && map) {
      fetchGeoJSONData();
    }
  }, [fetchDataRequired, map]);

  useEffect(() => {
    if (drawnGeoJSON) {
      fetchAvailableDates(drawnGeoJSON, cloudCover);
    }
  }, [cloudCover]);

  const handleIndexChange = event => {
    setSelectedIndex(event.target.value);
  };

  const handleDateChange = date => {
    const formattedDate = format(date, 'yyyy-MM-dd');
    setSelectedDate(formattedDate);
    console.log(selectedDate);
  };

  const handleCloudCoverChange = event => {
    setCloudCover(event.target.value);
  };

  const handleFetchData = () => {
    if (selectedIndex && selectedDate && drawnGeoJSON) {
      setFetchDataRequired(true);
    } else {
      toast.error('Please select Index, Date, and draw a feature on the map.');
    }
  };

  const toggleBaseLayer = () => {
    setBaseLayer(baseLayer === 'google' ? 'osm' : 'google'); // Toggle between 'google' and 'osm'
  };

  const getToggleButtonText = () => {
    return baseLayer === 'google' ? 'Switch to OSM' : 'Switch to Google Satellite';
  };

  const isDateSelectable = date => {
    return availableDates.some(availableDate => 
      isAfter(date, startOfDay(availableDate)) && 
      isBefore(date, endOfDay(availableDate))
    );
  };

  const CustomDateInput = React.forwardRef(({ value, onClick, loading }, ref) => (
    <div className="custom-date-input" onClick={onClick} ref={ref}>
      {loading ? (
        <div className="loading-tooltip">
          <FaSpinner className="spinner" /> Loading dates...
        </div>
      ) : (
        value || 'Select a date'
      )}
    </div>
  ));

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
          <div>
          <p>Filter image date by Cloud Cover</p>
          <input type="number" value={cloudCover} onChange={handleCloudCoverChange} min="0" max="100" />
        </div>
          <DatePicker
            selected={selectedDate}
            onChange={handleDateChange}
            includeDates={availableDates} // Only allow selectable dates
            placeholderText="Select a date"
            customInput={<CustomDateInput loading={loadingDates} />}
          />
        </div>
       
        <div className='sidebar-buttons'>
          <button onClick={handleFetchData}>Fetch Data</button>
          <button onClick={toggleBaseLayer}>{getToggleButtonText()}</button>
        </div>
      </div>
      {loading && (
        <div className="loader-container">
          <div className="loader"></div>
        </div>
      )}
      <div ref={mapRef} className="map-container"></div>
      <div className="buttons">
        <button onClick={addDrawInteraction}>Draw Polygon</button>
        <button onClick={removeDrawInteraction}>Stop Drawing</button>
        <button onClick={clearDrawnFeatures}>Clear Drawing</button>
      </div>
      <ToastContainer position="top-center" />
      <div className="legend">
        <h3>Legend</h3>
        <ul>
          {Object.entries(legendColors).map(([className, color]) => (
            <li key={className}>
              <span className="legend-color-box" style={{ backgroundColor: color }}></span>
              {className}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default MapComponent;
