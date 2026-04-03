"use client"

import { useMemo } from "react"
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { Badge } from "@/components/ui/badge"

// Fix for default markers in Next.js
const icon = L.icon({
  iconUrl: "/marker-icon.png",
  iconRetinaUrl: "/marker-icon-2x.png",
  shadowUrl: "/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

const clusterIcon = L.divIcon({
  className: "custom-cluster-icon",
  html: `<div style="
    background-color: #3b82f6;
    color: white;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    border: 3px solid white;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
  ">?</div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
})

interface Voter {
  _id: string
  name: string
  status: "pending" | "done" | "locked" | "revisit" | "wrong_address"
  visited?: boolean
  areaCluster: string
  displayAddress: string
  phoneNumber?: string
  age: string
  gender: string
  lat?: number
  lng?: number
}

interface ClusterData {
  areaCluster: string
  lat: number
  lng: number
  count: number
  pending: number
  done: number
  revisit: number
  voters: Voter[]
}

interface VoterMapProps {
  voters: Voter[]
  userLocation: { lat: number; lng: number } | null
}

export default function VoterMap({ voters, userLocation }: VoterMapProps) {
  // Group voters by area cluster
  const clusters = useMemo(() => {
    const clusterMap = new Map<string, ClusterData>()
    let votersWithCoords = 0
    
    voters.forEach((voter) => {
      if (!voter.lat || !voter.lng) return
      
      votersWithCoords++
      const key = voter.areaCluster
      if (!clusterMap.has(key)) {
        clusterMap.set(key, {
          areaCluster: key,
          lat: voter.lat,
          lng: voter.lng,
          count: 0,
          pending: 0,
          done: 0,
          revisit: 0,
          voters: [],
        })
      }
      
      const cluster = clusterMap.get(key)!
      cluster.count++
      cluster.voters.push(voter)
      
      if (voter.status === "pending") cluster.pending++
      else if (voter.status === "done") cluster.done++
      else if (voter.status === "revisit") cluster.revisit++
    })
    
    // Filter out clusters with only 1 voter and sort by count (descending)
    return Array.from(clusterMap.values())
      .filter(cluster => cluster.count >= 2)
      .sort((a, b) => b.count - a.count)
  }, [voters])
  
  // Count voters without coordinates
  const votersWithoutCoords = useMemo(() => {
    return voters.filter(v => !v.lat || !v.lng).length
  }, [voters])

  // Default center (Pimple Saudagar area)
  const defaultCenter: [number, number] = [18.595, 73.789]
  const center: [number, number] = userLocation 
    ? [userLocation.lat, userLocation.lng]
    : defaultCenter

  if (clusters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">No location clusters available</p>
          <p className="text-xs text-muted-foreground mt-1">
            {voters.length} voters ({votersWithoutCoords} without coordinates)
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={14}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {/* User location circle */}
        {userLocation && (
          <Circle
            center={[userLocation.lat, userLocation.lng]}
            radius={2000}
            pathOptions={{ color: "blue", fillColor: "blue", fillOpacity: 0.1 }}
          />
        )}
        
        {/* Cluster markers */}
        {clusters.map((cluster) => (
          <Marker
            key={cluster.areaCluster}
            position={[cluster.lat, cluster.lng]}
            icon={L.divIcon({
              className: "custom-cluster-icon",
              html: `<div style="
                background-color: ${cluster.pending > 0 ? '#f59e0b' : '#22c55e'};
                color: white;
                border-radius: 50%;
                width: ${Math.min(50, 30 + cluster.count * 2)}px;
                height: ${Math.min(50, 30 + cluster.count * 2)}px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                font-size: 14px;
                border: 3px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
              ">${cluster.count}</div>`,
              iconSize: [Math.min(50, 30 + cluster.count * 2), Math.min(50, 30 + cluster.count * 2)],
              iconAnchor: [Math.min(50, 30 + cluster.count * 2) / 2, Math.min(50, 30 + cluster.count * 2) / 2],
            })}
          >
            <Popup>
              <div className="p-2 min-w-[200px]">
                <h3 className="font-semibold mb-2">{cluster.areaCluster}</h3>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Total:</span>
                    <span className="font-medium">{cluster.count}</span>
                  </div>
                  <div className="flex justify-between text-yellow-600">
                    <span>Pending:</span>
                    <span className="font-medium">{cluster.pending}</span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>Done:</span>
                    <span className="font-medium">{cluster.done}</span>
                  </div>
                  {cluster.revisit > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Revisit:</span>
                      <span className="font-medium">{cluster.revisit}</span>
                    </div>
                  )}
                </div>
                <div className="mt-3 pt-2 border-t text-xs text-muted-foreground">
                  Approximate location
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      
      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-background/90 p-3 rounded-lg shadow-lg text-xs space-y-2 z-[1000]">
        <div className="font-medium mb-1">Legend</div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-yellow-500 border-2 border-white"></div>
          <span>Has Pending</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-green-500 border-2 border-white"></div>
          <span>All Done</span>
        </div>
        {userLocation && (
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-blue-500 bg-blue-500/20"></div>
            <span>Your Location (2km)</span>
          </div>
        )}
        <div className="text-muted-foreground mt-2">
          {clusters.length} areas shown • {voters.length - votersWithoutCoords} with coords • {votersWithoutCoords} without
        </div>
        <div className="text-xs text-muted-foreground">
          (Clusters with 1 voter hidden)
        </div>
      </div>
    </div>
  )
}
