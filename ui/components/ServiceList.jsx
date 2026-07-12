import React, { useState } from 'react';
import './ServiceList.css';

function ServiceList({ services, loading, onLoadServices }) {
  const [selectedServices, setSelectedServices] = useState(
    services.map(s => s.entityId)
  );

  const toggleService = (serviceId) => {
    setSelectedServices(prev =>
      prev.includes(serviceId)
        ? prev.filter(id => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const toggleAll = () => {
    if (selectedServices.length === services.length) {
      setSelectedServices([]);
    } else {
      setSelectedServices(services.map(s => s.entityId));
    }
  };

  const getSelectedServicesData = () => {
    return services.filter(s => selectedServices.includes(s.entityId));
  };

  return (
    <div className="service-list-container">
      <div className="service-controls">
        <h3>Services ({services.length})</h3>
        <button
          className="select-all-button"
          onClick={toggleAll}
        >
          {selectedServices.length === services.length ? '❌ Deselect All' : '✅ Select All'}
        </button>
      </div>

      <div className="service-items">
        {loading ? (
          <p className="loading-text">⏳ Loading services...</p>
        ) : services.length === 0 ? (
          <p className="empty-text">No services found</p>
        ) : (
          services.map(service => (
            <div key={service.entityId} className="service-item">
              <label>
                <input
                  type="checkbox"
                  checked={selectedServices.includes(service.entityId)}
                  onChange={() => toggleService(service.entityId)}
                />
                <div className="service-info">
                  <div className="service-name">{service.displayName}</div>
                  <div className="service-id">{service.entityId}</div>
                </div>
              </label>
            </div>
          ))
        )}
      </div>

      <div className="service-stats">
        <p>Selected: <strong>{selectedServices.length}</strong> / {services.length}</p>
      </div>

      {selectedServices.length > 0 && (
        <div className="export-preview">
          <h4>📤 Export Preview</h4>
          <p>Ready to export <strong>{selectedServices.length}</strong> service{selectedServices.length !== 1 ? 's' : ''}</p>
        </div>
      )}
    </div>
  );
}

export default ServiceList;
