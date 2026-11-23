-- One square tile of the package counter's top (scenes/office.scene.json places them; `slot` counts from the left): a place for one parcel.
-- Nothing is drawn (the counter's model has the painted squares); scenes/office.lua and entities/item.lua find where a parcel lies by it.
return nova.entity { tags = { "tile" } }
