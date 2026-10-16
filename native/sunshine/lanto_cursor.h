#pragma once
#include <string>

namespace lanto {
// Called only from the paired-client HTTPS handler.
std::string cursor_xml(const std::string &previous_id);
}
